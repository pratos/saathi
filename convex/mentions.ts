import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireRoomPermission } from "./lib/authz";

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
