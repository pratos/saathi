import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { requireAiAccess, requireRoomPermission } from "./lib/authz";
import { DEFAULT_MODEL_TIER, resolveModelTier } from "./lib/modelTiers";
import { containsSaathiMention, mentionedUsernames, SAATHI_SYSTEM_PROMPT, stripSaathiMention } from "./lib/saathi";

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
    const mentioned = mentionedUsernames(text);
    const explicitlyMentioned = containsSaathiMention(text);
    const mentions: Array<
      | { kind: "assistant"; username: "saathi" }
      | { kind: "person"; username: string; userId: Id<"users"> }
    > = explicitlyMentioned ? [{ kind: "assistant", username: "saathi" }] : [];
    const personHandles = new Set(mentioned.filter(username => username !== "saathi"));
    if (personHandles.size) {
      const grants = await ctx.db.query("roomMembers")
        .withIndex("by_room_user", q => q.eq("roomId", room._id))
        .take(100);
      const roomUsers = await Promise.all(grants.map(async grant => {
        const [roomUser, membership] = await Promise.all([
          ctx.db.get(grant.userId),
          ctx.db.query("memberships").withIndex("by_space_user", q => q.eq("spaceId", room.spaceId).eq("userId", grant.userId)).unique(),
        ]);
        return membership?.status === "active" ? roomUser : null;
      }));
      for (const roomUser of roomUsers) {
        if (roomUser?.username && personHandles.has(roomUser.username)) {
          mentions.push({ kind: "person", username: roomUser.username, userId: roomUser._id });
        }
      }
    }
    const messageId = await ctx.db.insert("messages", {
      spaceId: room.spaceId, roomId: args.roomId, authorUserId: userId, actorType: "user", origin: "app",
      originalText: text, language: args.language, idempotencyKey: args.clientOperationId,
      mentions: mentions.length ? mentions : undefined, createdAt: Date.now(),
    });

    const shouldInvokeSaathi = room.assistantMode !== "off";
    if (shouldInvokeSaathi) {
      await requireAiAccess(ctx, room.spaceId, "openrouter");
      const agentRate = await limits.limit(ctx, "mentionSaathi", { key: `${room.spaceId}:${userId}` });
      if (!agentRate.ok) {
        if (explicitlyMentioned) throw new ConvexError({ code: "RATE_LIMITED", retryAfter: agentRate.retryAfter });
        return messageId;
      }

      let agent = await ctx.db.query("agents").withIndex("by_room", q => q.eq("roomId", room._id)).first();
      if (!agent) {
        const now = Date.now();
        const space = await ctx.db.get(room.spaceId);
        const route = resolveModelTier(space?.modelTier ?? DEFAULT_MODEL_TIER);
        const agentId = await ctx.db.insert("agents", {
          spaceId: room.spaceId, roomId: room._id, createdBy: userId, creationKey: "saathi-default",
          name: "Saathi", systemPrompt: SAATHI_SYSTEM_PROMPT, provider: "openrouter", model: route.model,
          status: "idle", createdAt: now, updatedAt: now,
        });
        agent = (await ctx.db.get(agentId))!;
      }
      const messageForSaathi = stripSaathiMention(text) ||
        "Introduce yourself briefly and ask how you can help this family.";
      const personMentionContext = mentions.some(mention => mention.kind === "person")
        ? ` Tagged family members: ${mentions.filter(mention => mention.kind === "person").map(mention => `@${mention.username}`).join(", ")}.`
        : "";
      const prompt = explicitlyMentioned
        ? `You were explicitly mentioned. Respond helpfully to: ${messageForSaathi}${personMentionContext}`
        : room.assistantMode === "automatic"
          ? `Respond helpfully to this message in the private automatic-assistant conversation: ${messageForSaathi}${personMentionContext}`
          : `Ambiently assess this family message. Respond only if your input is useful; otherwise output exactly [NO_REPLY]. Message: ${messageForSaathi}${personMentionContext}`;
      await ctx.db.insert("agentJobs", {
        agentId: agent._id, requestedBy: userId, prompt, clientOperationId: args.clientOperationId,
        status: "queued", attempt: 0,
        trigger: explicitlyMentioned ? "mention" : room.assistantMode === "automatic" ? "automatic" : "ambient",
        createdAt: Date.now(),
      });
      if (agent.status === "idle") {
        await ctx.db.patch(agent._id, { status: "running", lastError: undefined, updatedAt: Date.now() });
        await ctx.scheduler.runAfter(0, internal.agentWorker.run, { agentId: agent._id });
      }
    }
    return messageId;
  },
});
