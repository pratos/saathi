import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, query } from "./_generated/server";
import { requireSpacePermission } from "./lib/authz";
import { decideAgentTurn } from "./lib/jev";
import { inboxClassificationResultValidator, type InboxClassificationResult } from "./lib/inboxClassification";
import { isSuperadminUser } from "./lib/platformAccess";
import { resolveDecisionCredential } from "./lib/providerKeys";

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

export const recent = query({
  args: { spaceId: v.id("spaces"), limit: v.optional(v.number()) },
  returns: v.array(decisionView),
  handler: async (ctx, { spaceId, limit }) => {
    const { user } = await requireSpacePermission(ctx, spaceId, "configure_inbox");
    if (!isSuperadminUser(user)) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Jev debug is restricted to deployment superadmins" });
    }
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
    outputTokens: v.number(),
    latencyMs: v.number(),
  }),
  handler: async (ctx, { spaceId, text }) => {
    const request = text.trim();
    if (!request || request.length > 12_000) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Enter between 1 and 12,000 characters." });
    }
    const userId: Id<"users"> = await ctx.runMutation(internal.jev.prepareLab, { spaceId });
    const credential = await resolveDecisionCredential(ctx, spaceId, userId);
    const result = await decideAgentTurn(credential, request);
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
  returns: v.id("users"),
  handler: async (ctx, { spaceId }) => {
    const { userId, user } = await requireSpacePermission(ctx, spaceId, "configure_inbox");
    if (!isSuperadminUser(user)) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Jev debug is restricted to deployment superadmins" });
    }
    const rate = await limits.limit(ctx, "lab", { key: String(userId) });
    if (!rate.ok) throw new ConvexError({ code: "RATE_LIMITED", retryAfter: rate.retryAfter });
    return userId;
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
