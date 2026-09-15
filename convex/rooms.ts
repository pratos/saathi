import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireRoomPermission, requireSpacePermission } from "./lib/authz";

export async function ensurePersonalRoomForUser(ctx: MutationCtx, spaceId: Id<"spaces">, userId: Id<"users">) {
  const existing = await ctx.db.query("rooms")
    .withIndex("by_space", q => q.eq("spaceId", spaceId))
    .filter(q => q.eq(q.field("personalOwnerId"), userId))
    .unique();
  if (existing) return existing._id;
  const now = Date.now();
  const roomId = await ctx.db.insert("rooms", {
    spaceId,
    type: "private",
    title: "My Saathi",
    assistantMode: "automatic",
    personalOwnerId: userId,
    createdBy: userId,
    createdAt: now,
  });
  await ctx.db.insert("roomMembers", { roomId, userId, role: "manager", createdAt: now });
  await ctx.db.insert("auditEvents", {
    spaceId,
    actorUserId: userId,
    action: "room.personal_created",
    resourceType: "room",
    resourceId: String(roomId),
    createdAt: now,
  });
  return roomId;
}

export const list = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "read");
    const grants = await ctx.db.query("roomMembers").withIndex("by_user", q => q.eq("userId", userId)).collect();
    const rows = await Promise.all(grants.map(async grant => ({ grant, room: await ctx.db.get(grant.roomId) })));
    return rows.filter(row => row.room?.spaceId === spaceId && !row.room.archivedAt);
  },
});

export const ensurePersonal = mutation({
  args: { spaceId: v.id("spaces") },
  returns: v.id("rooms"),
  handler: async (ctx, { spaceId }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "read");
    return await ensurePersonalRoomForUser(ctx, spaceId, userId);
  },
});

export const messages = query({
  args: { roomId: v.id("rooms"), limit: v.optional(v.number()) },
  handler: async (ctx, { roomId, limit }) => {
    await requireRoomPermission(ctx, roomId, "read");
    return ctx.db.query("messages").withIndex("by_room_created", q => q.eq("roomId", roomId)).order("desc").take(Math.min(Math.max(limit ?? 50, 1), 100));
  },
});
