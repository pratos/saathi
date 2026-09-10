import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type DbCtx = QueryCtx | MutationCtx;
type SpacePermission = "read" | "manage_members" | "configure_inbox";
type RoomPermission = "read" | "post_message" | "manage_room";

function denied(): never {
  throw new ConvexError({ code: "FORBIDDEN", message: "You do not have permission to access this resource" });
}

export async function requireUser(ctx: DbCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in required" });
  const user = await ctx.db.get(userId);
  if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "User no longer exists" });
  return { userId, user };
}

export async function requireSpacePermission(ctx: DbCtx, spaceId: Id<"spaces">, permission: SpacePermission) {
  const { userId, user } = await requireUser(ctx);
  const membership = await ctx.db.query("memberships").withIndex("by_space_user", q => q.eq("spaceId", spaceId).eq("userId", userId)).unique();
  if (!membership || membership.status !== "active") denied();
  if (permission !== "read" && membership.role !== "owner") denied();
  return { userId, user, membership };
}

export async function requireRoomPermission(ctx: DbCtx, roomId: Id<"rooms">, permission: RoomPermission) {
  const room = await ctx.db.get(roomId);
  if (!room) denied();
  const { userId, user, membership } = await requireSpacePermission(ctx, room.spaceId, "read");
  // Space ownership intentionally does not bypass a room grant.
  const roomMember = await ctx.db.query("roomMembers").withIndex("by_room_user", q => q.eq("roomId", roomId).eq("userId", userId)).unique();
  if (!roomMember) denied();
  if (permission === "post_message" && roomMember.role === "viewer") denied();
  if (permission === "manage_room" && roomMember.role !== "manager") denied();
  return { userId, user, membership, roomMember, room };
}

export async function requireInboxItemPermission(ctx: DbCtx, itemId: Id<"inboxItems">, permission: "read") {
  const item = await ctx.db.get(itemId);
  if (!item) denied();
  const principal = await requireSpacePermission(ctx, item.spaceId, "read");
  if (item.visibility === "private" && item.privateOwnerId !== principal.userId) denied();
  if (item.visibility === "room") {
    if (!item.roomId) denied();
    await requireRoomPermission(ctx, item.roomId, permission);
  }
  return { ...principal, item };
}
