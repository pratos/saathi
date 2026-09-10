import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSpacePermission, requireUser } from "./lib/authz";

export const create = mutation({
  args: { name: v.string(), creationKey: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const name = args.name.trim();
    if (name.length < 2 || name.length > 80) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Family name must be between 2 and 80 characters" });
    }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(args.creationKey)) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid creation key" });
    }
    const existing = await ctx.db.query("spaces").withIndex("by_creator_key", q => q.eq("createdBy", userId).eq("creationKey", args.creationKey)).unique();
    if (existing) return existing._id;

    const now = Date.now();
    const spaceId = await ctx.db.insert("spaces", { name, createdBy: userId, creationKey: args.creationKey, createdAt: now });
    await ctx.db.insert("memberships", { spaceId, userId, role: "owner", status: "active", joinedAt: now });
    const roomId = await ctx.db.insert("rooms", {
      spaceId, type: "shared", title: "Family conversation", assistantMode: "mention", createdBy: userId, createdAt: now,
    });
    await ctx.db.insert("roomMembers", { roomId, userId, role: "manager", createdAt: now });
    await ctx.db.insert("auditEvents", {
      spaceId, actorUserId: userId, action: "space.created", resourceType: "space", resourceId: String(spaceId), createdAt: now,
    });
    return spaceId;
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx);
    const memberships = await ctx.db.query("memberships").withIndex("by_user_status", q => q.eq("userId", userId).eq("status", "active")).collect();
    return Promise.all(memberships.map(async membership => ({ membership, space: await ctx.db.get(membership.spaceId) })));
  },
});

// The client passes the selected space on every scoped request; no server-side
// "active space" can accidentally bleed data between reactive subscriptions.
export const switcherData = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { user, membership } = await requireSpacePermission(ctx, spaceId, "read");
    const space = await ctx.db.get(spaceId);
    return { user, membership, space };
  },
});
