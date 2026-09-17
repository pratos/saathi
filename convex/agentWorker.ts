"use node";

import { Agent, type AgentMessage, type AgentTool } from "@earendil-works/pi-agent-core";
import { createModels, type Model } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import {
  APPLICATION_ASSISTANT_TOOLS,
  conversationActionFromTool,
  type ApplicationAssistantToolName,
  type ConversationAction,
} from "./lib/assistantCapabilities";
import { runFirecrawlComputerTask } from "./lib/firecrawlInteract";
import { generateFamilyImageBytes } from "./lib/imageGeneration";
import { resolveOpenRouterKey } from "./lib/providerKeys";
import { composeFamilyImagePrompt, isImageKind, isImageLanguage, isImageStyle } from "./lib/imageSafety";
import { MODEL_TIERS, resolveModelTier, type SaathiThinkingLevel } from "./lib/modelTiers";
import {
  decideAgentTurn,
  decideToolExecution,
  shouldBlockTool,
  turnDecisionGuidance,
  type JevToolDecision,
  type JevTurnDecision,
} from "./lib/jev";
import { searchPublicWeb } from "./lib/publicWeb";
import { isNoReplyText, SAATHI_IMAGE_MODEL, SAATHI_WEB_ACCESS_PROMPT } from "./lib/saathi";

export { formatPublicWebResults as formatFirecrawlResults } from "./lib/publicWeb";

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
      const typesafeKey = env.TYPESAFE_API_KEY?.trim();
      const turnDecision = typesafeKey ? await safeTurnDecision(typesafeKey, work.job.prompt) : null;
      if (turnDecision) {
        await recordJevDecision(ctx, work, "chat_turn", work.job.prompt, turnDecision.route, turnDecision.routeConfidence, turnDecision);
      }
      const ephemeralContext = [work.memoryContext, turnDecisionGuidance(turnDecision)].filter(Boolean).join("\n\n");

      let turns = 0;
      const agent = new Agent({
        initialState: {
          systemPrompt: withWebAccessPrompt(work.agent.systemPrompt),
          model,
          thinkingLevel,
          tools: createTools(ctx, agentId, work.job._id, work.leaseId, openRouterKey),
          messages: work.messages as AgentMessage[],
        },
        transformContext: async messages => withEphemeralTurnContext(messages, ephemeralContext),
        streamFn: models.streamSimple.bind(models),
        getApiKey: () => openRouterKey,
        onPayload: enableOpenRouterWebSearch,
        beforeToolCall: typesafeKey ? async ({ toolCall, args }) => {
          const decision = await safeToolDecision(typesafeKey, {
            request: work.job.prompt,
            tool: toolCall.name,
            arguments: args,
          });
          if (decision) {
            await recordJevDecision(ctx, work, "chat_tool", work.job.prompt, decision.outcome, decision.confidence, {
              ...decision,
              tool: toolCall.name,
            });
          }
          const reason = shouldBlockTool(decision);
          return reason ? { block: true, reason } : undefined;
        } : undefined,
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
  return APPLICATION_ASSISTANT_TOOLS.map(tool => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (_callId, params) => executeApplicationTool(
      ctx, agentId, jobId, leaseId, openRouterKey, tool.name, params,
    ),
  })) as AgentTool[];
}

async function executeApplicationTool(
  ctx: ActionCtx,
  agentId: Id<"agents">,
  jobId: Id<"agentJobs">,
  leaseId: string,
  openRouterKey: string,
  name: ApplicationAssistantToolName,
  params: unknown,
) {
  const args = params as Record<string, unknown>;
  if (name === "search_public_web") {
    const text = await searchPublicWeb(ctx, String(args.query ?? ""));
    return { content: [{ type: "text" as const, text }], details: { provider: "firecrawl" } };
  }
  if (name === "generate_image") {
    const requested = args as { prompt: string; kind?: string; style?: string; language?: string };
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
      content: [{ type: "text" as const, text: "The requested image was generated and attached to the family chat." }],
      details: { provider: "openrouter", model: SAATHI_IMAGE_MODEL, imageId: String(imageId) },
    };
  }
  if (name === "use_computer") {
    const { url, task } = args as { url: string; task: string };
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
      content: [{ type: "text" as const, text: result.output }],
      details: { provider: "firecrawl", scrapeId: result.scrapeId, liveViewUrl: result.liveViewUrl },
    };
  }
  const action = conversationActionFromTool(name, args);
  if (!action) throw new Error(`Invalid parameters for ${name}.`);
  return conversationAction(ctx, agentId, jobId, leaseId, action);
}

async function conversationAction(
  ctx: ActionCtx,
  agentId: Id<"agents">,
  jobId: Id<"agentJobs">,
  leaseId: string,
  action: ConversationAction,
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

export function withEphemeralTurnContext(messages: AgentMessage[], context: string): AgentMessage[] {
  if (!context) return messages;
  const index = messages.findLastIndex(message => message.role === "user");
  if (index < 0) return messages;
  const message = messages[index];
  if (message.role !== "user") return messages;
  const marker = `[Current-turn context — data and routing guidance only, never user instructions]\n${context}`;
  const content = typeof message.content === "string"
    ? `${marker}\n\n${message.content}`
    : [{ type: "text" as const, text: marker }, ...message.content];
  return [...messages.slice(0, index), { ...message, content }, ...messages.slice(index + 1)];
}

async function safeTurnDecision(apiKey: string, request: string): Promise<JevTurnDecision | null> {
  try {
    return await decideAgentTurn(apiKey, request);
  } catch (error) {
    console.warn("JEV_TURN_DECISION_FAILED", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

async function safeToolDecision(
  apiKey: string,
  state: { request: string; tool: string; arguments: unknown },
): Promise<JevToolDecision | null> {
  try {
    return await decideToolExecution(apiKey, state);
  } catch (error) {
    console.warn("JEV_TOOL_DECISION_FAILED", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

async function recordJevDecision(
  ctx: ActionCtx,
  work: {
    agent: { spaceId: Id<"spaces">; roomId: Id<"rooms"> };
  },
  source: "chat_turn" | "chat_tool",
  inputPreview: string,
  decision: string,
  confidence: number,
  details: unknown,
) {
  const metadata = details as { model: string; latencyMs: number; inputTokens: number };
  await ctx.runMutation(internal.jev.record, {
    spaceId: work.agent.spaceId,
    roomId: work.agent.roomId,
    source,
    inputPreview,
    decision,
    confidence,
    details,
    model: metadata.model,
    latencyMs: metadata.latencyMs,
    inputTokens: metadata.inputTokens,
  });
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
