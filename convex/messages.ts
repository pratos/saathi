import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import { mutation } from "./_generated/server";
import { requireRoomPermission } from "./lib/authz";
import { SAATHI_MENTION, SAATHI_MODEL, SAATHI_SYSTEM_PROMPT } from "./lib/saathi";

const limits = new RateLimiter(components.rateLimiter, {
  postMessage: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 10 },
  mentionSaathi: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 5 },
});

export const post = mutation({
  args: {
    roomId: v.id("rooms"), text: v.string(), language: v.union(v.literal("en"), v.literal("hi"), v.literal("mr")), clientOperationId: v.string(),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    const { userId, room } = await requireRoomPermission(ctx, args.roomId, "post_message");
    const text = args.text.trim();
    if (!text || text.length > 20_000) throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Message must be between 1 and 20,000 characters" });
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(args.clientOperationId)) throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid client operation ID" });
    const existing = await ctx.db.query("messages").withIndex("by_room_idempotency", q => q.eq("roomId", args.roomId).eq("idempotencyKey", args.clientOperationId)).unique();
    if (existing) {
      if (existing.authorUserId !== userId) throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT", message: "Operation ID already used" });
      return existing._id;
    }
    const rate = await limits.limit(ctx, "postMessage", { key: String(userId) });
    if (!rate.ok) throw new ConvexError({ code: "RATE_LIMITED", retryAfter: rate.retryAfter });
    const messageId = await ctx.db.insert("messages", {
      spaceId: room.spaceId, roomId: args.roomId, authorUserId: userId, actorType: "user", origin: "app",
      originalText: text, language: args.language, idempotencyKey: args.clientOperationId, createdAt: Date.now(),
    });

    const explicitlyMentioned = SAATHI_MENTION.test(text);
    const shouldInvokeSaathi = room.assistantMode !== "off";
    if (shouldInvokeSaathi) {
      const agentRate = await limits.limit(ctx, "mentionSaathi", { key: `${room.spaceId}:${userId}` });
      if (!agentRate.ok) {
        if (explicitlyMentioned) throw new ConvexError({ code: "RATE_LIMITED", retryAfter: agentRate.retryAfter });
        return messageId;
      }

      let agent = await ctx.db.query("agents").withIndex("by_room", q => q.eq("roomId", room._id)).first();
      if (!agent) {
        const now = Date.now();
        const agentId = await ctx.db.insert("agents", {
          spaceId: room.spaceId, roomId: room._id, createdBy: userId, creationKey: "saathi-default",
          name: "Saathi", systemPrompt: SAATHI_SYSTEM_PROMPT, provider: "openrouter", model: SAATHI_MODEL,
          status: "idle", createdAt: now, updatedAt: now,
        });
        agent = (await ctx.db.get(agentId))!;
      }
      const messageForSaathi = text.replace(SAATHI_MENTION, "").trim() ||
        "Introduce yourself briefly and ask how you can help this family.";
      const prompt = explicitlyMentioned
        ? `You were explicitly mentioned. Respond helpfully to: ${messageForSaathi}`
        : `Ambiently assess this family message. Respond only if your input is useful; otherwise output exactly [NO_REPLY]. Message: ${messageForSaathi}`;
      await ctx.db.insert("agentJobs", {
        agentId: agent._id, requestedBy: userId, prompt, clientOperationId: args.clientOperationId,
        status: "queued", attempt: 0, trigger: explicitlyMentioned ? "mention" : "ambient", createdAt: Date.now(),
      });
      if (agent.status === "idle") {
        await ctx.db.patch(agent._id, { status: "running", lastError: undefined, updatedAt: Date.now() });
        await ctx.scheduler.runAfter(0, internal.agentWorker.run, { agentId: agent._id });
      }
    }
    return messageId;
  },
});
