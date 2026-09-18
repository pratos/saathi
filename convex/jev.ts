import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import { action, env, internalMutation, query } from "./_generated/server";
import { requireSpacePermission, requireUser } from "./lib/authz";
import { decideAgentTurn } from "./lib/jev";
import { inboxClassificationResultValidator, type InboxClassificationResult } from "./lib/inboxClassification";

const BENCHMARK_ADMIN_EMAIL = "prathamesh.b.sarang@gmail.com";

const limits = new RateLimiter(components.rateLimiter, {
  lab: { kind: "fixed window", rate: 30, period: HOUR },
});

const source = v.union(
  v.literal("chat_turn"),
  v.literal("chat_tool"),
  v.literal("voice_tool"),
  v.literal("voice_browser"),
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
  inboxItemId: v.optional(v.id("inboxItems")),
  source,
  artifactSource: v.optional(v.literal("agentmail")),
  inputPreview: v.string(),
  decision: v.string(),
  confidence: v.optional(v.number()),
  details: v.any(),
  model: v.string(),
  latencyMs: v.number(),
  inputTokens: v.number(),
  disposition: v.optional(v.string()),
  classificationState: v.optional(v.union(v.literal("pending"), v.literal("complete"))),
  createdAt: v.number(),
  execution: v.optional(execution),
});

const benchmarkLanguageResult = v.object({
  language: v.string(),
  passed: v.number(),
  total: v.number(),
});

const benchmarkLatency = v.object({
  medianMs: v.number(),
  p95Ms: v.number(),
});

const benchmarkConditionResult = v.object({
  id: v.string(), label: v.string(), catalogTools: v.number(), passed: v.number(), total: v.number(),
  wrongCalls: v.number(), safetySignificantCalls: v.number(),
  averageExposedTools: v.number(), narrowingRate: v.optional(v.number()), fallbackRate: v.optional(v.number()),
  routeLatency: v.optional(benchmarkLatency), piLatency: benchmarkLatency,
  endToEndLatency: benchmarkLatency,
  routeCostUsd: v.number(), piCostUsd: v.number(), combinedCostUsd: v.number(),
  promptTokens: v.number(), cacheTokens: v.number(),
});

const benchmarkReportView = v.object({
  runAt: v.string(), commit: v.string(), model: v.string(), repetitions: v.number(), casesPerCondition: v.number(),
  memory: v.object({
    passed: v.number(), total: v.number(), averageLatencyMs: v.number(), inputTokens: v.number(), costUsd: v.number(),
    languages: v.array(benchmarkLanguageResult),
  }),
  conditions: v.array(benchmarkConditionResult),
  promotionGates: v.object({
    currentAccuracyDeltaPoints: v.number(), expandedAccuracyDeltaPoints: v.number(),
    noSafetyRegression: v.boolean(), expandedP95ReductionPercent: v.number(), expandedCostReductionPercent: v.number(),
    accuracyPassed: v.boolean(), safetyPassed: v.boolean(), latencyPassed: v.boolean(), costPassed: v.boolean(),
  }),
  recommendation: v.string(), projectedFromPostPiGateRun: v.boolean(),
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
      commit: "5af76abe20241ac7dfa6309083fb1a6ff363a482",
      model: "openai/gpt-5.6-luna",
      repetitions: 3,
      casesPerCondition: 117,
      memory: {
        passed: 33, total: 36, averageLatencyMs: 146, inputTokens: 46_522, costUsd: 0.001953924,
        languages: [
          { language: "English", passed: 11, total: 12 },
          { language: "Hindi / Hinglish", passed: 10, total: 12 },
          { language: "Marathi", passed: 12, total: 12 },
        ],
      },
      conditions: [
        { id: "A", label: "Direct Pi · 15 tools", catalogTools: 15, passed: 106, total: 117, wrongCalls: 0, safetySignificantCalls: 0, averageExposedTools: 15, piLatency: { medianMs: 640, p95Ms: 1_451 }, endToEndLatency: { medianMs: 640, p95Ms: 1_451 }, routeCostUsd: 0, piCostUsd: 0.0351011, combinedCostUsd: 0.0351011, promptTokens: 704_163, cacheTokens: 681_935 },
        { id: "B", label: "Direct Pi · 200 tools", catalogTools: 200, passed: 107, total: 117, wrongCalls: 0, safetySignificantCalls: 0, averageExposedTools: 200, piLatency: { medianMs: 1_542, p95Ms: 2_434 }, endToEndLatency: { medianMs: 1_542, p95Ms: 2_434 }, routeCostUsd: 0, piCostUsd: 0.09588498, combinedCostUsd: 0.09588498, promptTokens: 2_543_095, cacheTokens: 2_510_189 },
        { id: "C", label: "Jev pre-turn · full 15 tools", catalogTools: 15, passed: 100, total: 117, wrongCalls: 2, safetySignificantCalls: 0, averageExposedTools: 15, routeLatency: { medianMs: 180, p95Ms: 300 }, piLatency: { medianMs: 588, p95Ms: 1_525 }, endToEndLatency: { medianMs: 807, p95Ms: 1_677 }, routeCostUsd: 0.003929436, piCostUsd: 0.08467525, combinedCostUsd: 0.088604686, promptTokens: 714_583, cacheTokens: 697_545 },
        { id: "D", label: "Jev pre-turn · full 200 tools", catalogTools: 200, passed: 107, total: 117, wrongCalls: 0, safetySignificantCalls: 0, averageExposedTools: 200, routeLatency: { medianMs: 180, p95Ms: 300 }, piLatency: { medianMs: 1_531, p95Ms: 2_494 }, endToEndLatency: { medianMs: 1_740, p95Ms: 2_683 }, routeCostUsd: 0.003929436, piCostUsd: 0.08648722, combinedCostUsd: 0.090416656, promptTokens: 2_551_186, cacheTokens: 2_514_076 },
      ],
      promotionGates: {
        currentAccuracyDeltaPoints: -5.1282, expandedAccuracyDeltaPoints: 0,
        noSafetyRegression: true, expandedP95ReductionPercent: -10.2301, expandedCostReductionPercent: 5.703,
        accuracyPassed: false, safetyPassed: true, latencyPassed: false, costPassed: false,
      },
      recommendation: "Keep direct Pi as the default. Jev pre-turn guidance preserved 200-tool accuracy, but it did not improve safety in this corpus and failed the p95 latency and cost gates.",
      projectedFromPostPiGateRun: true,
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

export const record = internalMutation({
  args: {
    spaceId: v.id("spaces"),
    roomId: v.optional(v.id("rooms")),
    jobId: v.optional(v.id("agentJobs")),
    inboxItemId: v.optional(v.id("inboxItems")),
    source,
    inputPreview: v.string(),
    decision: v.string(),
    confidence: v.optional(v.number()),
    details: v.any(),
    model: v.string(),
    latencyMs: v.number(),
    inputTokens: v.number(),
    disposition: v.optional(v.string()),
  },
  returns: v.id("jevDecisions"),
  handler: async (ctx, args) => ctx.db.insert("jevDecisions", {
    ...args,
    inputPreview: args.inputPreview.replace(/\s+/g, " ").trim().slice(0, 500),
    createdAt: Date.now(),
  }),
});

export const completeTurnToolRouting = internalMutation({
  args: {
    decisionId: v.id("jevDecisions"),
    jobId: v.id("agentJobs"),
    outcome: v.object({
      selectedToolNames: v.array(v.string()),
      metrics: v.any(),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { decisionId, jobId, outcome }) => {
    const decision = await ctx.db.get(decisionId);
    if (!decision || decision.source !== "chat_turn" || decision.jobId !== jobId) return null;
    const details = decision.details && typeof decision.details === "object" && !Array.isArray(decision.details)
      ? decision.details as Record<string, unknown>
      : {};
    await ctx.db.patch(decisionId, { details: { ...details, toolRoutingOutcome: outcome } });
    return null;
  },
});

export const claimInboxClassification = internalMutation({
  args: { inboxItemId: v.id("inboxItems") },
  returns: v.boolean(),
  handler: async (ctx, { inboxItemId }) => {
    const item = await ctx.db.get(inboxItemId);
    if (!item || item.agentmailMessageId.startsWith("gmail:")) return false;
    if (item.jevDecisionId) {
      const existing = await ctx.db.get(item.jevDecisionId);
      return existing?.artifactSource === "agentmail" && existing.classificationState === "pending";
    }
    const decisionId = await ctx.db.insert("jevDecisions", {
      spaceId: item.spaceId,
      roomId: item.roomId,
      inboxItemId,
      source: "gmail",
      artifactSource: "agentmail",
      inputPreview: "Shared household inbox email",
      decision: "pending",
      details: {},
      model: "jev-email",
      latencyMs: 0,
      inputTokens: 0,
      disposition: "pending",
      classificationState: "pending",
      createdAt: Date.now(),
    });
    await ctx.db.patch(inboxItemId, { jevDecisionId: decisionId });
    return true;
  },
});

export const completeInboxClassification = internalMutation({
  args: { inboxItemId: v.id("inboxItems"), result: inboxClassificationResultValidator },
  returns: v.null(),
  handler: async (ctx, { inboxItemId, result }) => {
    const item = await ctx.db.get(inboxItemId);
    if (!item?.jevDecisionId) return null;
    const record = await ctx.db.get(item.jevDecisionId);
    if (!record || record.classificationState === "complete") return null;
    if (record.spaceId !== item.spaceId || record.artifactSource !== "agentmail") return null;
    const telemetry = classificationTelemetry(result, item.category, item.status);
    await ctx.db.patch(record._id, { ...telemetry, classificationState: "complete" });
    return null;
  },
});

function classificationTelemetry(
  result: InboxClassificationResult,
  downstreamCategory: string,
  downstreamStatus: string,
) {
  if (result.kind === "classified") {
    return {
      decision: result.decision.category,
      confidence: result.decision.confidence,
      details: {
        probabilities: result.decision.probabilities,
        tracksHouseholdMoney: result.decision.tracksHouseholdMoney,
        containsOtpOrLoginCode: result.decision.containsOtpOrLoginCode,
        downstreamCategory,
        downstreamStatus,
      },
      model: result.decision.model,
      latencyMs: result.decision.latencyMs,
      inputTokens: result.decision.inputTokens,
      disposition: result.disposition,
    };
  }
  return {
    decision: "unavailable",
    confidence: undefined,
    details: { reason: result.reason, downstreamCategory, downstreamStatus },
    model: result.model,
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
    disposition: result.disposition,
  };
}
