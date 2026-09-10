import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireRoomPermission, requireSpacePermission } from "./lib/authz";

export const list = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "read");
    const grants = await ctx.db.query("roomMembers").withIndex("by_user", q => q.eq("userId", userId)).collect();
    const rows = await Promise.all(grants.map(async grant => ({ grant, room: await ctx.db.get(grant.roomId) })));
    return rows.filter(row => row.room?.spaceId === spaceId && !row.room.archivedAt);
  },
});

export const messages = query({
  args: { roomId: v.id("rooms"), limit: v.optional(v.number()) },
  handler: async (ctx, { roomId, limit }) => {
    await requireRoomPermission(ctx, roomId, "read");
    return ctx.db.query("messages").withIndex("by_room_created", q => q.eq("roomId", roomId)).order("desc").take(Math.min(Math.max(limit ?? 50, 1), 100));
  },
});
