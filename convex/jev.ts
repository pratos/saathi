import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, env, internalMutation, query } from "./_generated/server";
import { requireRoomPermission, requireSpacePermission } from "./lib/authz";
import { decideAgentTurn, decideToolExecution, shouldBlockTool } from "./lib/jev";

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

const decisionView = v.object({
  _id: v.id("jevDecisions"),
  _creationTime: v.number(),
  spaceId: v.id("spaces"),
  roomId: v.optional(v.id("rooms")),
  source,
  inputPreview: v.string(),
  decision: v.string(),
  confidence: v.optional(v.number()),
  details: v.any(),
  model: v.string(),
  latencyMs: v.number(),
  inputTokens: v.number(),
  createdAt: v.number(),
});

export const recent = query({
  args: { spaceId: v.id("spaces"), limit: v.optional(v.number()) },
  returns: v.array(decisionView),
  handler: async (ctx, { spaceId, limit }) => {
    await requireSpacePermission(ctx, spaceId, "configure_inbox");
    return ctx.db.query("jevDecisions").withIndex("by_space_created", q =>
      q.eq("spaceId", spaceId),
    ).order("desc").take(Math.min(Math.max(limit ?? 30, 1), 100));
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
