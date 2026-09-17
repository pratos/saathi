import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, env, internalMutation, query } from "./_generated/server";
import { requireRoomPermission, requireSpacePermission, requireUser } from "./lib/authz";
import { decideAgentTurn, decideToolExecution, shouldBlockTool } from "./lib/jev";

const BENCHMARK_ADMIN_EMAIL = "prathamesh.b.sarang@gmail.com";

const limits = new RateLimiter(components.rateLimiter, {
  lab: { kind: "fixed window", rate: 30, period: HOUR },
  voiceTool: { kind: "fixed window", rate: 60, period: HOUR },
});

const source = v.union(
  v.literal("chat_turn"),
  v.literal("chat_tool"),
  v.literal("voice_tool"),
  v.literal("gmail"),
  v.literal("lab"),
);

const execution = v.object({
  status: v.union(v.literal("queued"), v.literal("running"), v.literal("complete"), v.literal("failed")),
  trigger: v.optional(v.union(v.literal("mention"), v.literal("ambient"), v.literal("automatic"))),
  activity: v.optional(v.union(v.literal("searching_web"), v.literal("generating_image"), v.literal("using_computer"))),
  responsePreview: v.optional(v.string()),
  error: v.optional(v.string()),
});

const decisionView = v.object({
  _id: v.id("jevDecisions"),
  _creationTime: v.number(),
  spaceId: v.id("spaces"),
  roomId: v.optional(v.id("rooms")),
  jobId: v.optional(v.id("agentJobs")),
  source,
  inputPreview: v.string(),
  decision: v.string(),
  confidence: v.optional(v.number()),
  details: v.any(),
  model: v.string(),
  latencyMs: v.number(),
  inputTokens: v.number(),
  createdAt: v.number(),
  execution: v.optional(execution),
});

const benchmarkLanguageResult = v.object({
  language: v.string(),
  passed: v.number(),
  total: v.number(),
});

const toolSelectionResult = v.object({
  toolCount: v.number(), passed: v.number(), total: v.number(), wrongCalls: v.number(), safetySignificantCalls: v.number(),
  medianLatencyMs: v.number(), p95LatencyMs: v.number(), promptTokens: v.number(), completionTokens: v.number(),
  cacheTokens: v.number(), totalCostUsd: v.number(), averageCostPerTurnUsd: v.number(),
});

const benchmarkReportView = v.object({
  runAt: v.string(),
  routing: v.object({
    passed: v.number(), total: v.number(), averageLatencyMs: v.number(), inputTokens: v.number(), costUsd: v.number(),
    wrongRestrictedBundles: v.number(), clarificationOnlyTurns: v.number(), fullToolFallbacks: v.number(),
    multiTurnPassed: v.number(), multiTurnTotal: v.number(), multiToolPassed: v.number(), multiToolTotal: v.number(),
    languages: v.array(benchmarkLanguageResult),
  }),
  memory: v.object({
    passed: v.number(), total: v.number(), averageLatencyMs: v.number(), inputTokens: v.number(), costUsd: v.number(),
    languages: v.array(benchmarkLanguageResult),
  }),
  toolSelection: v.object({
    model: v.string(), repetitions: v.number(), currentCatalog: toolSelectionResult, expandedCatalog: toolSelectionResult,
  }),
  comparison: v.object({
    assumptions: v.object({ piInputPerMillionUsd: v.number(), piCacheReadPerMillionUsd: v.number(), jevInputPerMillionUsd: v.number(), tokenEstimate: v.string() }),
    fullTools: v.object({ toolCount: v.number(), estimatedSchemaTokens: v.number(), uncachedCostPerTurnUsd: v.number(), cachedCostPerTurnUsd: v.number() }),
    jevBundles: v.object({ averageToolCount: v.number(), estimatedSchemaTokens: v.number(), piUncachedCostPerTurnUsd: v.number(), piCachedCostPerTurnUsd: v.number(), jevCostPerTurnUsd: v.number(), combinedUncachedCostPerTurnUsd: v.number(), combinedCachedCostPerTurnUsd: v.number() }),
    uncachedSavingsPercent: v.number(),
  }),
  scale: v.object({
    fullToolCount: v.number(), selectedToolCount: v.number(), bundleCount: v.number(),
    fullSchemaTokens: v.number(), selectedSchemaTokens: v.number(), schemaReductionPercent: v.number(),
    fullUncachedCostPerTurnUsd: v.number(), routedUncachedCostPerTurnUsd: v.number(),
    fullCachedCostPerTurnUsd: v.number(), routedCachedCostPerTurnUsd: v.number(),
  }),
});

export const benchmarkReport = query({
  args: {},
  returns: benchmarkReportView,
  handler: async (ctx) => {
    const { user } = await requireUser(ctx);
    if (user.email?.trim().toLowerCase() !== BENCHMARK_ADMIN_EMAIL) {
      throw new ConvexError({ code: "FORBIDDEN", message: "You do not have permission to access benchmark reports" });
    }
    return {
      runAt: "2026-09-17",
      routing: {
        passed: 39, total: 39, averageLatencyMs: 124, inputTokens: 31_135, costUsd: 0.00130767,
        wrongRestrictedBundles: 0, clarificationOnlyTurns: 7, fullToolFallbacks: 8,
        multiTurnPassed: 12, multiTurnTotal: 12, multiToolPassed: 3, multiToolTotal: 3,
        languages: [
          { language: "English", passed: 13, total: 13 },
          { language: "Hindi / Hinglish", passed: 13, total: 13 },
          { language: "Marathi", passed: 13, total: 13 },
        ],
      },
      memory: {
        passed: 33, total: 36, averageLatencyMs: 146, inputTokens: 46_522, costUsd: 0.001953924,
        languages: [
          { language: "English", passed: 11, total: 12 },
          { language: "Hindi / Hinglish", passed: 10, total: 12 },
          { language: "Marathi", passed: 12, total: 12 },
        ],
      },
      toolSelection: {
        model: "openai/gpt-5.6-luna",
        repetitions: 1,
        currentCatalog: {
          toolCount: 15, passed: 30, total: 39, wrongCalls: 7, safetySignificantCalls: 4,
          medianLatencyMs: 548, p95LatencyMs: 1_013, promptTokens: 228_051, completionTokens: 4_941,
          cacheTokens: 218_234, totalCostUsd: 0.01261553, averageCostPerTurnUsd: 0.000323475,
        },
        expandedCatalog: {
          toolCount: 200, passed: 32, total: 39, wrongCalls: 2, safetySignificantCalls: 2,
          medianLatencyMs: 1_497, p95LatencyMs: 3_430, promptTokens: 873_930, completionTokens: 4_787,
          cacheTokens: 847_552, totalCostUsd: 0.02915734, averageCostPerTurnUsd: 0.000747624,
        },
      },
      comparison: {
        assumptions: {
          piInputPerMillionUsd: 0.5,
          piCacheReadPerMillionUsd: 0.003,
          jevInputPerMillionUsd: 0.042,
          tokenEstimate: "Current application and provider tool JSON characters divided by four; common prompt, conversation, output, and model reasoning are excluded.",
        },
        fullTools: {
          toolCount: 15, estimatedSchemaTokens: 1_683,
          uncachedCostPerTurnUsd: 0.0008415, cachedCostPerTurnUsd: 0.000005049,
        },
        jevBundles: {
          averageToolCount: 4.49, estimatedSchemaTokens: 491,
          piUncachedCostPerTurnUsd: 0.0002455, piCachedCostPerTurnUsd: 0.000001473,
          jevCostPerTurnUsd: 0.00003353,
          combinedUncachedCostPerTurnUsd: 0.00027903,
          combinedCachedCostPerTurnUsd: 0.000035003,
        },
        uncachedSavingsPercent: 66.8,
      },
      scale: {
        fullToolCount: 200, selectedToolCount: 10, bundleCount: 20,
        fullSchemaTokens: 22_502, selectedSchemaTokens: 1_121, schemaReductionPercent: 95,
        fullUncachedCostPerTurnUsd: 0.011251, routedUncachedCostPerTurnUsd: 0.00059403,
        fullCachedCostPerTurnUsd: 0.000067506, routedCachedCostPerTurnUsd: 0.000036893,
      },
    };
  },
});

export const recent = query({
  args: { spaceId: v.id("spaces"), limit: v.optional(v.number()) },
  returns: v.array(decisionView),
  handler: async (ctx, { spaceId, limit }) => {
    await requireSpacePermission(ctx, spaceId, "configure_inbox");
    const decisions = await ctx.db.query("jevDecisions").withIndex("by_space_created", q =>
      q.eq("spaceId", spaceId),
    ).order("desc").take(Math.min(Math.max(limit ?? 30, 1), 100));
    return Promise.all(decisions.map(async decision => {
      if (!decision.jobId) return { ...decision, execution: undefined };
      const job = await ctx.db.get(decision.jobId);
      if (!job) return { ...decision, execution: undefined };
      const agent = await ctx.db.get(job.agentId);
      if (!agent || agent.spaceId !== spaceId) return { ...decision, execution: undefined };
      return {
        ...decision,
        execution: {
          status: job.status,
          trigger: job.trigger,
          activity: job.activity,
          responsePreview: job.responseText?.replace(/\s+/g, " ").trim().slice(0, 500),
          error: job.error?.replace(/\s+/g, " ").trim().slice(0, 500),
        },
      };
    }));
  },
});

export const evaluate = action({
  args: { spaceId: v.id("spaces"), text: v.string() },
  returns: v.object({
    route: v.string(),
    routeConfidence: v.number(),
    routeProbabilities: v.record(v.string(), v.number()),
    needsClarification: v.number(),
    model: v.string(),
    inputTokens: v.number(),
    latencyMs: v.number(),
  }),
  handler: async (ctx, { spaceId, text }) => {
    const request = text.trim();
    if (!request || request.length > 12_000) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Enter between 1 and 12,000 characters." });
    }
    await ctx.runMutation(internal.jev.prepareLab, { spaceId });
    const apiKey = env.TYPESAFE_API_KEY?.trim();
    if (!apiKey) throw new ConvexError({ code: "JEV_NOT_CONFIGURED", message: "TypeSafe is not configured." });
    const result = await decideAgentTurn(apiKey, request);
    await ctx.runMutation(internal.jev.record, {
      spaceId,
      source: "lab",
      inputPreview: request,
      decision: result.route,
      confidence: result.routeConfidence,
      details: result,
      model: result.model,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
    });
    return result;
  },
});

export const authorizeVoiceTool = action({
  args: {
    roomId: v.id("rooms"),
    requestText: v.string(),
    tool: v.string(),
    arguments: v.any(),
  },
  returns: v.object({ ok: v.boolean(), message: v.string() }),
  handler: async (ctx, args): Promise<{ ok: boolean; message: string }> => {
    const prepared: { spaceId: Id<"spaces"> } = await ctx.runMutation(internal.jev.prepareVoiceTool, {
      roomId: args.roomId,
    });
    const request = args.requestText.trim().slice(0, 8_000);
    const apiKey = env.TYPESAFE_API_KEY?.trim();
    if (!apiKey || !request) return { ok: true, message: "Allowed" };
    try {
      const decision = await decideToolExecution(apiKey, {
        request,
        tool: args.tool.slice(0, 100),
        arguments: args.arguments,
      });
      await ctx.runMutation(internal.jev.record, {
        spaceId: prepared.spaceId,
        roomId: args.roomId,
        source: "voice_tool",
        inputPreview: request,
        decision: decision.outcome,
        confidence: decision.confidence,
        details: { ...decision, tool: args.tool },
        model: decision.model,
        latencyMs: decision.latencyMs,
        inputTokens: decision.inputTokens,
      });
      const reason = shouldBlockTool(decision);
      return reason ? { ok: false, message: reason } : { ok: true, message: "Allowed" };
    } catch (error) {
      console.warn("JEV_VOICE_DECISION_FAILED", error instanceof Error ? error.name : "unknown");
      return { ok: true, message: "Allowed" };
    }
  },
});

export const prepareLab = internalMutation({
  args: { spaceId: v.id("spaces") },
  returns: v.null(),
  handler: async (ctx, { spaceId }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "configure_inbox");
    const rate = await limits.limit(ctx, "lab", { key: String(userId) });
    if (!rate.ok) throw new ConvexError({ code: "RATE_LIMITED", retryAfter: rate.retryAfter });
    return null;
  },
});

export const prepareVoiceTool = internalMutation({
  args: { roomId: v.id("rooms") },
  returns: v.object({ spaceId: v.id("spaces") }),
  handler: async (ctx, { roomId }) => {
    const { room, userId } = await requireRoomPermission(ctx, roomId, "post_message");
    const rate = await limits.limit(ctx, "voiceTool", { key: String(userId) });
    if (!rate.ok) throw new ConvexError({ code: "RATE_LIMITED", retryAfter: rate.retryAfter });
    return { spaceId: room.spaceId };
  },
});

export const record = internalMutation({
  args: {
    spaceId: v.id("spaces"),
    roomId: v.optional(v.id("rooms")),
    jobId: v.optional(v.id("agentJobs")),
    source,
    inputPreview: v.string(),
    decision: v.string(),
    confidence: v.optional(v.number()),
    details: v.any(),
    model: v.string(),
    latencyMs: v.number(),
    inputTokens: v.number(),
  },
  returns: v.id("jevDecisions"),
  handler: async (ctx, args) => ctx.db.insert("jevDecisions", {
    ...args,
    inputPreview: args.inputPreview.replace(/\s+/g, " ").trim().slice(0, 500),
    createdAt: Date.now(),
  }),
});
