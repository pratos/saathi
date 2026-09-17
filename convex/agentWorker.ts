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
import { runFirecrawlComputerTask } from "./lib/firecrawlInteract";
import { generateFamilyImageBytes } from "./lib/imageGeneration";
import { resolveOpenRouterKey } from "./lib/providerKeys";
import { composeFamilyImagePrompt, isImageKind, isImageLanguage, isImageStyle, type ImageStyle } from "./lib/imageSafety";
import { MODEL_TIERS, resolveModelTier, type SaathiThinkingLevel } from "./lib/modelTiers";
import { isNoReplyText, SAATHI_IMAGE_MODEL, SAATHI_WEB_ACCESS_PROMPT } from "./lib/saathi";

const firecrawl = new FirecrawlClient(components.firecrawl);

const thinkingLevelMap = { off: "none" as const, minimal: null, low: "low" as const, medium: "medium" as const, high: "high" as const, xhigh: null, max: "max" as const };

function openRouterTextModel(id: string, name: string, cost: { input: number; output: number }): Model<"openai-completions"> {
  return {
    id,
    name,
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    reasoning: true,
    thinkingLevelMap,
    input: ["text"],
    cost: { ...cost, cacheRead: 0.003, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 8_192,
    compat: { supportsDeveloperRole: false, thinkingFormat: "openrouter", requiresReasoningContentOnAssistantMessages: true },
  };
}

const extraOpenRouterModels = [
  openRouterTextModel(MODEL_TIERS.low.model, "DeepSeek V4.1 Flash", { input: 0.15, output: 0.6 }),
  openRouterTextModel(MODEL_TIERS.med.model, "GPT-5.6 Luna", { input: 0.5, output: 2 }),
  openRouterTextModel(MODEL_TIERS.high.model, "Grok 4.6", { input: 1.5, output: 6 }),
  openRouterTextModel(MODEL_TIERS.ultra.model, "GPT-5.6 Sol", { input: 2, output: 8 }),
];

export const run = internalAction({
  args: { agentId: v.id("agents") },
  returns: v.null(),
  handler: async (ctx, { agentId }): Promise<null> => {
    const work = await ctx.runMutation(internal.agents.beginNext, { agentId });
    if (!work) return null;

    try {
      const openRouterKey = await resolveOpenRouterKey(ctx, work.agent.spaceId);
      const route = extraOpenRouterModels.some(item => item.id === work.agent.model)
        ? extraOpenRouterModels.find(item => item.id === work.agent.model)!
        : extraOpenRouterModels[1];
      const thinkingLevel: SaathiThinkingLevel = resolveModelTier(
        extraOpenRouterModels.find(item => item.id === work.agent.model)?.id === MODEL_TIERS.low.model ? "low"
          : work.agent.model === MODEL_TIERS.high.model ? "high"
            : work.agent.model === MODEL_TIERS.ultra.model ? "ultra"
              : "med",
      ).thinkingLevel;
      const models = createModels();
      const baseProvider = openrouterProvider();
      models.setProvider({ ...baseProvider, getModels: () => [...baseProvider.getModels(), ...extraOpenRouterModels] });
      const model = models.getModel("openrouter", work.agent.model) ?? models.getModel("openrouter", route.id);
      if (!model) throw new Error(`Unsupported agent model: ${work.agent.model}`);

      let turns = 0;
      const agent = new Agent({
        initialState: {
          systemPrompt: withWebAccessPrompt(work.agent.systemPrompt),
          model,
          thinkingLevel,
          tools: createTools(ctx, agentId, work.job._id, work.leaseId, openRouterKey),
          messages: work.messages as AgentMessage[],
        },
        streamFn: models.streamSimple.bind(models),
        getApiKey: () => openRouterKey,
        onPayload: enableOpenRouterWebSearch,
        sessionId: String(agentId),
        shouldStopAfterTurn: () => ++turns >= 12,
      });

      let persistedText = "";
      agent.subscribe(async (event) => {
        const toolActivity = event.type === "tool_execution_start" || event.type === "tool_execution_end"
          ? event.toolName === "search_public_web" ? "searching_web" as const
            : event.toolName === "generate_image" ? "generating_image" as const
            : event.toolName === "use_computer" ? "using_computer" as const : undefined
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
      const usage = assistantUsage(agent.state.messages);
      await ctx.runMutation(internal.agents.finish, {
        agentId, jobId: work.job._id, leaseId: work.leaseId, nextSequence: work.nextSequence,
        messages, error: agent.state.errorMessage, inputTokens: usage.input, outputTokens: usage.output,
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
  openRouterKey: string,
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
      description: "Generate one family-safe image for this room when a person explicitly requests an image, infographic, or respectful devotional artwork. Never create sexual, nude, or graphic violent images.",
      parameters: Type.Object({
        prompt: Type.String({ minLength: 3, maxLength: 2_000 }),
        kind: Type.Optional(Type.Union([Type.Literal("scene"), Type.Literal("infographic"), Type.Literal("devotional")])),
        style: Type.Optional(Type.Union([
          Type.Literal("warm_family"), Type.Literal("kitchen_table"), Type.Literal("festival_home"), Type.Literal("storybook"),
          Type.Literal("family_collage"), Type.Literal("memory_grid"), Type.Literal("scrapbook"), Type.Literal("fridge_photos"),
          Type.Literal("infographic"), Type.Literal("step_cards"), Type.Literal("kids_chart"), Type.Literal("wall_poster"),
          Type.Literal("devotional"), Type.Literal("diya_aarti"), Type.Literal("rangoli"), Type.Literal("festival_altar"),
          Type.Literal("watercolor"), Type.Literal("flat"), Type.Literal("folk_art"), Type.Literal("block_print"),
        ])),
        language: Type.Optional(Type.Union([Type.Literal("en"), Type.Literal("hi"), Type.Literal("mr")])),
      }, { additionalProperties: false }),
      execute: async (_callId, params) => {
        const requested = params as { prompt: string; kind?: string; style?: string; language?: string };
        const preferences = await ctx.runQuery(internal.agents.computerJobContext, { agentId, jobId, leaseId });
        const kind = isImageKind(requested.kind) ? requested.kind : "scene";
        const style = isImageStyle(requested.style) ? requested.style : preferences?.imageStyle ?? "warm_family";
        const language = isImageLanguage(requested.language) ? requested.language : preferences?.language ?? "en";
        const prompt = composeFamilyImagePrompt({ prompt: requested.prompt, kind, style, language });
        const generated = await generateFamilyImageBytes(prompt, openRouterKey);
        const storageId = await ctx.storage.store(new Blob([generated.bytes], { type: generated.mediaType }));
        let imageId: Id<"generatedImages"> | null;
        try {
          imageId = await ctx.runMutation(internal.agents.saveGeneratedImage, {
            agentId, jobId, leaseId, storageId, prompt: requested.prompt.trim(), model: SAATHI_IMAGE_MODEL, mediaType: generated.mediaType,
            kind, style, language,
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
      name: "use_computer", label: "Use computer",
      description: "Open a public https website in Firecrawl Interact so the family can watch and, if needed, sign in in the live browser. Use only when a person explicitly asks to browse, click through, log in, or operate a site. Never type passwords, OTPs, or payment details. Never checkout, pay, or place an order. Browser cookies stay in a Firecrawl profile for this person so later visits can continue without storing passwords in Saathi.",
      parameters: Type.Object({
        url: Type.String({ minLength: 8, maxLength: 2_000 }),
        task: Type.String({ minLength: 3, maxLength: 4_000 }),
      }, { additionalProperties: false }),
      execute: async (_callId, params) => {
        const { url, task } = params as { url: string; task: string };
        const job = await ctx.runQuery(internal.agents.computerJobContext, { agentId, jobId, leaseId });
        if (!job) throw new Error("Computer use was discarded because room access changed.");
        const result = await runFirecrawlComputerTask({
          apiKey: env.FIRECRAWL_API_KEY,
          url,
          task,
          profileName: job.profileName,
          onLiveView: async (view) => {
            await ctx.runMutation(internal.agents.updateComputerView, {
              agentId, jobId, leaseId,
              liveViewUrl: view.liveViewUrl,
              interactiveLiveViewUrl: view.interactiveLiveViewUrl,
            });
          },
        });
        return {
          content: [{ type: "text", text: result.output }],
          details: { provider: "firecrawl", scrapeId: result.scrapeId, liveViewUrl: result.liveViewUrl },
        };
      },
    },
    {
      name: "set_reading_language", label: "Set reading language",
      description: "Change this person's reading language only after they explicitly ask. Use en for English, hi for Hindi, or mr for Marathi.",
      parameters: Type.Object({ language: Type.Union([Type.Literal("en"), Type.Literal("hi"), Type.Literal("mr")]) }, { additionalProperties: false }),
      execute: async (_callId, params) => conversationAction(ctx, agentId, jobId, leaseId, {
        type: "set_language", language: (params as { language: "en" | "hi" | "mr" }).language,
      }),
    },
    {
      name: "set_image_style", label: "Set image style",
      description: "Change this person's default image style only after they explicitly ask.",
      parameters: Type.Object({ style: Type.Union([
        Type.Literal("warm_family"), Type.Literal("kitchen_table"), Type.Literal("festival_home"), Type.Literal("storybook"),
        Type.Literal("family_collage"), Type.Literal("memory_grid"), Type.Literal("scrapbook"), Type.Literal("fridge_photos"),
        Type.Literal("infographic"), Type.Literal("step_cards"), Type.Literal("kids_chart"), Type.Literal("wall_poster"),
        Type.Literal("devotional"), Type.Literal("diya_aarti"), Type.Literal("rangoli"), Type.Literal("festival_altar"),
        Type.Literal("watercolor"), Type.Literal("flat"), Type.Literal("folk_art"), Type.Literal("block_print"),
      ]) }, { additionalProperties: false }),
      execute: async (_callId, params) => conversationAction(ctx, agentId, jobId, leaseId, {
        type: "set_image_style", style: (params as { style: ImageStyle }).style,
      }),
    },
    {
      name: "set_food_budget", label: "Set food budget",
      description: "Set the monthly family food budget only after an owner explicitly gives an amount and currency.",
      parameters: Type.Object({ amount: Type.Number(), currency: Type.Union([Type.Literal("INR"), Type.Literal("USD")]) }, { additionalProperties: false }),
      execute: async (_callId, params) => {
        const requested = params as { amount: number; currency: "INR" | "USD" };
        return conversationAction(ctx, agentId, jobId, leaseId, { type: "set_food_budget", ...requested });
      },
    },
    {
      name: "set_model_tier", label: "Set thinking level",
      description: "Change the family Saathi thinking level only after an owner explicitly asks. Medium is the normal default; high and ultra use more resources.",
      parameters: Type.Object({ tier: Type.Union([Type.Literal("low"), Type.Literal("med"), Type.Literal("high"), Type.Literal("ultra")]) }, { additionalProperties: false }),
      execute: async (_callId, params) => conversationAction(ctx, agentId, jobId, leaseId, {
        type: "set_model_tier", tier: (params as { tier: "low" | "med" | "high" | "ultra" }).tier,
      }),
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

async function conversationAction(
  ctx: ActionCtx,
  agentId: Id<"agents">,
  jobId: Id<"agentJobs">,
  leaseId: string,
  action: { type: "set_language"; language: "en" | "hi" | "mr" }
    | { type: "set_image_style"; style: ImageStyle }
    | { type: "set_food_budget"; amount: number; currency: "INR" | "USD" }
    | { type: "set_model_tier"; tier: "low" | "med" | "high" | "ultra" },
) {
  const result = await ctx.runMutation(internal.conversationActions.executeForJob, { agentId, jobId, leaseId, action });
  return { content: [{ type: "text" as const, text: result.message }], details: { applied: result.ok } };
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

function assistantUsage(messages: AgentMessage[]) {
  let input = 0;
  let output = 0;
  for (const message of messages) {
    if (message.role !== "assistant" || !message.usage) continue;
    input += message.usage.input || 0;
    output += message.usage.output || 0;
  }
  return { input, output };
}

function assistantText(message: AgentMessage) {
  if (message.role !== "assistant") return "";
  const text = message.content.flatMap(block => block.type === "text" ? [block.text] : []).join("").trim();
  return isNoReplyText(text) ? "" : text;
}
