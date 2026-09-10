"use node";

import { Agent, type AgentMessage, type AgentTool } from "@earendil-works/pi-agent-core";
import { createModels, type Model } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { v } from "convex/values";
import { Type } from "typebox";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";

const MODEL_ID = "deepseek/deepseek-v4.1-flash";
const deepSeekModel: Model<"openai-completions"> = {
  id: MODEL_ID,
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
          systemPrompt: work.agent.systemPrompt,
          model,
          thinkingLevel: "high",
          tools: createMemoryTools(ctx, agentId),
          messages: work.messages as AgentMessage[],
        },
        streamFn: models.streamSimple.bind(models),
        getApiKey: () => env.OPENROUTER_API_KEY,
        sessionId: String(agentId),
        shouldStopAfterTurn: () => ++turns >= 12,
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

function createMemoryTools(ctx: ActionCtx, agentId: Id<"agents">): AgentTool[] {
  return [
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

function makeConvexSafe(messages: AgentMessage[]): unknown[] {
  return JSON.parse(JSON.stringify(messages)) as unknown[];
}
