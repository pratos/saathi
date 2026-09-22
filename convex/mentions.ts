import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRoomPermission, requireSpacePermission } from "./lib/authz";

export const candidates = query({
  args: { roomId: v.id("rooms") },
  returns: v.array(v.union(
    v.object({ kind: v.literal("assistant"), username: v.literal("saathi"), label: v.string() }),
    v.object({ kind: v.literal("person"), username: v.string(), label: v.string(), userId: v.id("users") }),
  )),
  handler: async (ctx, { roomId }) => {
    const { room } = await requireRoomPermission(ctx, roomId, "read");
    const grants = await ctx.db.query("roomMembers")
      .withIndex("by_room_user", q => q.eq("roomId", roomId))
      .take(100);
    const users = await Promise.all(grants.map(async grant => {
      const [user, membership] = await Promise.all([
        ctx.db.get(grant.userId),
        ctx.db.query("memberships").withIndex("by_space_user", q => q.eq("spaceId", room.spaceId).eq("userId", grant.userId)).unique(),
      ]);
      return membership?.status === "active" ? user : null;
    }));
    return [
      { kind: "assistant" as const, username: "saathi" as const, label: "Saathi" },
      ...users.flatMap(user => user?.username ? [{
        kind: "person" as const,
        username: user.username,
        label: user.displayName ?? user.name ?? `@${user.username}`,
        userId: user._id,
      }] : []),
    ];
  },
});

export const unreadForSpace = query({
  args: { spaceId: v.id("spaces") },
  returns: v.array(v.object({
    notificationId: v.id("mentionNotifications"),
    roomId: v.id("rooms"),
    messageId: v.id("messages"),
    actorLabel: v.string(),
    roomTitle: v.string(),
    createdAt: v.number(),
  })),
  handler: async (ctx, { spaceId }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "read");
    const rows = await ctx.db.query("mentionNotifications")
      .withIndex("by_user_space_status_created", q => q
        .eq("userId", userId)
        .eq("spaceId", spaceId)
        .eq("status", "unread"))
      .order("desc")
      .take(100);
    return (await Promise.all(rows.map(async row => {
      const [room, message, actor] = await Promise.all([
        ctx.db.get(row.roomId),
        ctx.db.get(row.messageId),
        ctx.db.get(row.actorUserId),
      ]);
      if (!room || room.spaceId !== spaceId || !message || message.roomId !== room._id) return null;
      return {
        notificationId: row._id,
        roomId: row.roomId,
        messageId: row.messageId,
        actorLabel: actor?.displayName ?? actor?.name ?? (actor?.username ? `@${actor.username}` : "A family member"),
        roomTitle: room.title,
        createdAt: row.createdAt,
      };
    }))).flatMap(row => row ? [row] : []);
  },
});

export const markRoomRead = mutation({
  args: { roomId: v.id("rooms") },
  returns: v.number(),
  handler: async (ctx, { roomId }) => {
    const { userId } = await requireRoomPermission(ctx, roomId, "read");
    const unread = await ctx.db.query("mentionNotifications")
      .withIndex("by_user_room_status", q => q
        .eq("userId", userId)
        .eq("roomId", roomId)
        .eq("status", "unread"))
      .take(100);
    const readAt = Date.now();
    await Promise.all(unread.map(row => ctx.db.patch(row._id, { status: "read", readAt })));
    return unread.length;
  },
});
