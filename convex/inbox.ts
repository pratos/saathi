import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireInboxItemPermission, requireSpacePermission } from "./lib/authz";

export const list = query({
  args: { spaceId: v.id("spaces"), limit: v.optional(v.number()) },
  handler: async (ctx, { spaceId, limit }) => {
    await requireSpacePermission(ctx, spaceId, "read");
    return ctx.db.query("inboxItems")
      .withIndex("by_space_visibility_received", q => q.eq("spaceId", spaceId).eq("visibility", "space"))
      .order("desc")
      .take(Math.min(Math.max(limit ?? 50, 1), 100));
  },
});

export const unreadCount = query({
  args: { spaceId: v.id("spaces") },
  returns: v.number(),
  handler: async (ctx, { spaceId }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "read");
    const state = await ctx.db.query("inboxReadStates")
      .withIndex("by_space_user", q => q.eq("spaceId", spaceId).eq("userId", userId))
      .unique();
    const items = await ctx.db.query("inboxItems")
      .withIndex("by_space_visibility_received", q => q.eq("spaceId", spaceId).eq("visibility", "space"))
      .order("desc")
      .take(20);
    if (!state) return items.length;
    return items.filter(item => item.receivedAt > state.lastSeenReceivedAt
      || (item.receivedAt === state.lastSeenReceivedAt && item._creationTime > state.lastSeenCreationTime)).length;
  },
});

export const markSeen = mutation({
  args: { inboxItemId: v.id("inboxItems") },
  returns: v.id("inboxReadStates"),
  handler: async (ctx, { inboxItemId }) => {
    const { userId, item } = await requireInboxItemPermission(ctx, inboxItemId, "read");
    if (item.visibility !== "space") throw new ConvexError({ code: "FORBIDDEN", message: "Only shared family inbox items can be marked seen" });
    const existing = await ctx.db.query("inboxReadStates")
      .withIndex("by_space_user", q => q.eq("spaceId", item.spaceId).eq("userId", userId))
      .unique();
    if (existing && (existing.lastSeenReceivedAt > item.receivedAt
      || (existing.lastSeenReceivedAt === item.receivedAt && existing.lastSeenCreationTime >= item._creationTime))) {
      return existing._id;
    }
    const values = {
      lastSeenReceivedAt: item.receivedAt,
      lastSeenCreationTime: item._creationTime,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, values);
      return existing._id;
    }
    return ctx.db.insert("inboxReadStates", { spaceId: item.spaceId, userId, ...values });
  },
});

export const confirmAction = mutation({
  args: { inboxItemId: v.id("inboxItems") },
  returns: v.id("inboxItems"),
  handler: async (ctx, { inboxItemId }) => {
    const { userId, item } = await requireInboxItemPermission(ctx, inboxItemId, "read");
    if (item.visibility !== "space") throw new ConvexError({ code: "FORBIDDEN", message: "Only shared family inbox items can be confirmed here" });
    if (item.actionStatus === "confirmed") return item._id;
    await ctx.db.patch(item._id, { actionStatus: "confirmed" });
    const familyRoom = item.roomId ?? (await ctx.db.query("rooms").withIndex("by_space", q => q.eq("spaceId", item.spaceId))
      .filter(q => q.eq(q.field("type"), "shared")).first())?._id;
    if (familyRoom) {
      const grant = await ctx.db.query("roomMembers").withIndex("by_room_user", q => q.eq("roomId", familyRoom).eq("userId", userId)).unique();
      if (grant && grant.role !== "viewer") {
        const action = item.suggestedActions?.[0];
        await ctx.db.insert("messages", {
          spaceId: item.spaceId,
          roomId: familyRoom,
          authorUserId: userId,
          actorType: "assistant",
          origin: "assistant",
          originalText: action
            ? `Confirmed family action: ${action.label}${action.detail ? ` — ${action.detail}` : ""}. Saathi will not send mail or change the account until a connected tool completes it.`
            : `Confirmed the family inbox item “${item.subject}”.`,
          language: "en",
          idempotencyKey: `inbox-action:${item._id}`,
          createdAt: Date.now(),
        });
      }
    }
    await ctx.db.insert("auditEvents", {
      spaceId: item.spaceId, actorUserId: userId, action: "inbox.action_confirmed",
      resourceType: "inboxItem", resourceId: String(item._id), createdAt: Date.now(),
    });
    return item._id;
  },
});

export const reprocess = mutation({
  args: { inboxItemId: v.id("inboxItems") },
  returns: v.id("inboxItems"),
  handler: async (ctx, { inboxItemId }) => {
    const { item } = await requireInboxItemPermission(ctx, inboxItemId, "read");
    if (item.visibility !== "space") throw new ConvexError({ code: "FORBIDDEN", message: "Only shared family inbox items can be reprocessed here" });
    if (item.status === "processing") return item._id;
    await ctx.db.patch(item._id, {
      status: "processing",
      heartbeatMessageId: undefined,
      documentParseStatus: undefined,
      documentParseRetryable: undefined,
      processingNotes: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.inboxWorkflow.enqueue, { inboxItemId: item._id });
    return item._id;
  },
});

export const dismissAction = mutation({
  args: { inboxItemId: v.id("inboxItems") },
  returns: v.id("inboxItems"),
  handler: async (ctx, { inboxItemId }) => {
    const { userId, item } = await requireInboxItemPermission(ctx, inboxItemId, "read");
    if (item.visibility !== "space") throw new ConvexError({ code: "FORBIDDEN", message: "Only shared family inbox items can be dismissed here" });
    if (item.actionStatus === "dismissed") return item._id;
    await ctx.db.patch(item._id, { actionStatus: "dismissed" });
    await ctx.db.insert("auditEvents", {
      spaceId: item.spaceId, actorUserId: userId, action: "inbox.action_dismissed",
      resourceType: "inboxItem", resourceId: String(item._id), createdAt: Date.now(),
    });
    return item._id;
  },
});
