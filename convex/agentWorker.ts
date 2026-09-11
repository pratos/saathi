"use node";

import { Agent, type AgentMessage, type AgentTool } from "@earendil-works/pi-agent-core";
import { createModels, type Model } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { FirecrawlClient, type SearchResponse } from "@firecrawl/firecrawl-convex";
import { v } from "convex/values";
import { Type } from "typebox";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { isNoReplyText, SAATHI_IMAGE_MODEL, SAATHI_MODEL, SAATHI_WEB_ACCESS_PROMPT } from "./lib/saathi";

const firecrawl = new FirecrawlClient(components.firecrawl);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const deepSeekModel: Model<"openai-completions"> = {
  id: SAATHI_MODEL,
  name: "DeepSeek: DeepSeek V4.1 Flash",
  api: "openai-completions",
  provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  reasoning: true,
  thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" },
  input: ["text"],
  cost: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
  contextWindow: 1_048_576,
  maxTokens: 8_192,
  compat: { supportsDeveloperRole: false, thinkingFormat: "openrouter", requiresReasoningContentOnAssistantMessages: true },
};

export const run = internalAction({
  args: { agentId: v.id("agents") },
  returns: v.null(),
  handler: async (ctx, { agentId }): Promise<null> => {
    const work = await ctx.runMutation(internal.agents.beginNext, { agentId });
    if (!work) return null;

    try {
      const models = createModels();
      const baseProvider = openrouterProvider();
      models.setProvider({ ...baseProvider, getModels: () => [...baseProvider.getModels(), deepSeekModel] });
      const model = models.getModel("openrouter", work.agent.model);
      if (!model) throw new Error(`Unsupported agent model: ${work.agent.model}`);

      let turns = 0;
      const agent = new Agent({
        initialState: {
          systemPrompt: withWebAccessPrompt(work.agent.systemPrompt),
          model,
          thinkingLevel: "high",
          tools: createTools(ctx, agentId, work.job._id, work.leaseId),
          messages: work.messages as AgentMessage[],
        },
        streamFn: models.streamSimple.bind(models),
        getApiKey: () => env.OPENROUTER_API_KEY,
        onPayload: enableOpenRouterWebSearch,
        sessionId: String(agentId),
        shouldStopAfterTurn: () => ++turns >= 12,
      });

      let persistedText = "";
      agent.subscribe(async (event) => {
        const toolActivity = event.type === "tool_execution_start" || event.type === "tool_execution_end"
          ? event.toolName === "search_public_web" ? "searching_web" as const
            : event.toolName === "generate_image" ? "generating_image" as const : undefined
          : undefined;
        if (event.type === "tool_execution_start" && toolActivity) {
          await ctx.runMutation(internal.agents.updateActivity, {
            agentId, jobId: work.job._id, leaseId: work.leaseId, activity: toolActivity,
          });
          return;
        }
        if (event.type === "tool_execution_end" && toolActivity) {
          await ctx.runMutation(internal.agents.updateActivity, {
            agentId, jobId: work.job._id, leaseId: work.leaseId, activity: undefined,
          });
          return;
        }
        if (event.type !== "message_update" && event.type !== "message_end") return;
        const responseText = assistantText(event.message);
        if (!responseText || responseText === persistedText) return;
        if (event.type === "message_update" && responseText.length - persistedText.length < 24) return;
        persistedText = responseText;
        await ctx.runMutation(internal.agents.updateProgress, {
          agentId, jobId: work.job._id, leaseId: work.leaseId, responseText,
        });
      });

      await agent.prompt(work.job.prompt);
      const messages = makeConvexSafe(agent.state.messages.slice(work.messages.length));
      await ctx.runMutation(internal.agents.finish, {
        agentId, jobId: work.job._id, leaseId: work.leaseId, nextSequence: work.nextSequence,
        messages, error: agent.state.errorMessage,
      });
    } catch (error) {
      await ctx.runMutation(internal.agents.fail, {
        agentId, jobId: work.job._id, leaseId: work.leaseId,
        error: error instanceof Error ? error.message : "Agent worker failed",
      });
    }
    return null;
  },
});

function createTools(
  ctx: ActionCtx,
  agentId: Id<"agents">,
  jobId: Id<"agentJobs">,
  leaseId: string,
): AgentTool[] {
  return [
    {
      name: "search_public_web", label: "Search public web",
      description: "Search current public web and news sources with Firecrawl. Use for recent news, changing facts, or claims that need current evidence. Never include private family data in the query.",
      parameters: Type.Object({ query: Type.String({ minLength: 2, maxLength: 300 }) }, { additionalProperties: false }),
      execute: async (_callId, params) => {
        const { query } = params as { query: string };
        const result = await firecrawl.search(ctx, query.trim(), {
          sources: ["news", "web"], limit: 4, highlights: true,
          scrapeOptions: { formats: ["markdown"], onlyMainContent: true, maxAge: 15 * 60 * 1000 },
        });
        return {
          content: [{ type: "text", text: formatFirecrawlResults(result) }],
          details: { provider: "firecrawl" },
        };
      },
    },
    {
      name: "generate_image", label: "Generate image",
      description: "Generate one image for the family chat only when a person explicitly requests an image. The finished image is attached to the current room.",
      parameters: Type.Object({ prompt: Type.String({ minLength: 3, maxLength: 2_000 }) }, { additionalProperties: false }),
      execute: async (_callId, params) => {
        const prompt = (params as { prompt: string }).prompt.trim();
        const generated = await generateImage(prompt);
        const storageId = await ctx.storage.store(new Blob([generated.bytes], { type: generated.mediaType }));
        let imageId: Id<"generatedImages"> | null;
        try {
          imageId = await ctx.runMutation(internal.agents.saveGeneratedImage, {
            agentId, jobId, leaseId, storageId, prompt, model: SAATHI_IMAGE_MODEL, mediaType: generated.mediaType,
          });
        } catch (error) {
          await ctx.storage.delete(storageId);
          throw error;
        }
        if (!imageId) {
          await ctx.storage.delete(storageId);
          throw new Error("Image was discarded because room access changed before it completed.");
        }
        return {
          content: [{ type: "text", text: "The requested image was generated and attached to the family chat." }],
          details: { provider: "openrouter", model: SAATHI_IMAGE_MODEL, imageId: String(imageId) },
        };
      },
    },
    {
      name: "remember", label: "Remember", description: "Store a short fact the family explicitly asked to retain.",
      parameters: Type.Object({ key: Type.String(), value: Type.String() }, { additionalProperties: false }),
      execute: async (_callId, params) => {
        const { key, value } = params as { key: string; value: string };
        await ctx.runMutation(internal.agents.remember, { agentId, key, value });
        return { content: [{ type: "text", text: `Remembered ${key}.` }], details: {} };
      },
    },
    {
      name: "recall", label: "Recall", description: "Recall a retained family fact by key.",
      parameters: Type.Object({ key: Type.String() }, { additionalProperties: false }),
      execute: async (_callId, params) => {
        const { key } = params as { key: string };
        const value = await ctx.runQuery(internal.agents.recall, { agentId, key });
        return { content: [{ type: "text", text: value ?? `No memory found for ${key}.` }], details: { found: value !== null } };
      },
    },
  ];
}

async function generateImage(prompt: string) {
  const response = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: SAATHI_IMAGE_MODEL, prompt, n: 1 }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`Image generation failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const payload: unknown = await response.json();
  const image = payload && typeof payload === "object" && "data" in payload && Array.isArray(payload.data)
    ? payload.data[0] : undefined;
  if (!image || typeof image !== "object" || !("b64_json" in image) || typeof image.b64_json !== "string") {
    throw new Error("Image provider returned no image data.");
  }
  const mediaType = "media_type" in image && typeof image.media_type === "string" ? image.media_type : "image/png";
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(mediaType)) throw new Error("Image provider returned an unsupported format.");
  const bytes = Uint8Array.from(Buffer.from(image.b64_json, "base64"));
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Generated image size is invalid.");
  return { bytes, mediaType };
}

export function enableOpenRouterWebSearch(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const request = payload as Record<string, unknown>;
  const tools = Array.isArray(request.tools) ? request.tools : [];
  return {
    ...request,
    tools: [...tools, {
      type: "openrouter:web_search",
      parameters: { engine: "auto", max_results: 4, max_uses: 2, max_total_results: 6 },
    }],
    max_tool_calls: 2,
  };
}

export function withWebAccessPrompt(systemPrompt: string) {
  return systemPrompt.includes("search_public_web")
    ? systemPrompt
    : `${systemPrompt}\n\n${SAATHI_WEB_ACCESS_PROMPT}`;
}

export function formatFirecrawlResults(result: SearchResponse) {
  const entries = [...(result.news ?? []), ...(result.web ?? [])].slice(0, 6);
  if (entries.length === 0) return "No relevant public web results were found.";
  return entries.map((entry, index) => {
    const metadata = "metadata" in entry && entry.metadata && typeof entry.metadata === "object"
      ? entry.metadata as Record<string, unknown> : undefined;
    const title = cleanText(("title" in entry ? entry.title : undefined) ?? metadata?.title) || `Source ${index + 1}`;
    const url = cleanText(("url" in entry ? entry.url : undefined) ?? metadata?.url ?? metadata?.sourceURL);
    const excerpt = cleanText(
      ("markdown" in entry ? entry.markdown : undefined) ??
      ("description" in entry ? entry.description : undefined) ??
      ("summary" in entry ? entry.summary : undefined),
    ).slice(0, 2_500);
    return [`Source ${index + 1}: ${title}`, url && `URL: ${url}`, excerpt && `Evidence: ${excerpt}`].filter(Boolean).join("\n");
  }).join("\n\n").slice(0, 12_000);
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function makeConvexSafe(messages: AgentMessage[]): unknown[] {
  return JSON.parse(JSON.stringify(messages)) as unknown[];
}

function assistantText(message: AgentMessage) {
  if (message.role !== "assistant") return "";
  const text = message.content.flatMap(block => block.type === "text" ? [block.text] : []).join("").trim();
  return isNoReplyText(text) ? "" : text;
}
