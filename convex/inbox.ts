import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireInboxItemPermission, requireSpacePermission } from "./lib/authz";

export const list = query({
  args: { spaceId: v.id("spaces"), limit: v.optional(v.number()) },
  handler: async (ctx, { spaceId, limit }) => {
    await requireSpacePermission(ctx, spaceId, "read");
    const candidates = await ctx.db.query("inboxItems").withIndex("by_space_received", q => q.eq("spaceId", spaceId)).order("desc").take(Math.min(Math.max(limit ?? 50, 1), 100));
    const allowed = [];
    for (const item of candidates) {
      if (item.visibility !== "space") continue;
      try {
        await requireInboxItemPermission(ctx, item._id, "read");
        allowed.push(item);
      } catch { /* Deliberately omit unauthorized private/room items. */ }
    }
    return allowed;
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
    await ctx.db.patch(item._id, { status: "received", heartbeatMessageId: undefined });
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
