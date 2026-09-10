import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { mutation } from "./_generated/server";
import { requireRoomPermission } from "./lib/authz";

const limits = new RateLimiter(components.rateLimiter, {
  postMessage: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 10 },
});

export const post = mutation({
  args: {
    roomId: v.id("rooms"), text: v.string(), language: v.union(v.literal("en"), v.literal("hi"), v.literal("mr")), clientOperationId: v.string(),
  },
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
    return ctx.db.insert("messages", {
      spaceId: room.spaceId, roomId: args.roomId, authorUserId: userId, actorType: "user", origin: "app",
      originalText: text, language: args.language, idempotencyKey: args.clientOperationId, createdAt: Date.now(),
    });
  },
});
