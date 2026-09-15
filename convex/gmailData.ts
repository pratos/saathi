import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireSpacePermission } from "./lib/authz";
import { ensurePersonalRoomForUser } from "./rooms";

const category = v.union(
  v.literal("bills"), v.literal("school"), v.literal("travel"), v.literal("subscriptions"),
  v.literal("home"), v.literal("receipts"), v.literal("needs_review"),
);

export const mine = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "read");
    return ctx.db.query("gmailConnections").withIndex("by_space_user", q => q.eq("spaceId", spaceId).eq("userId", userId)).collect();
  },
});

export const prepareConnect = internalQuery({
  args: { spaceId: v.id("spaces") },
  returns: v.object({ userId: v.id("users") }),
  handler: async (ctx, { spaceId }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "read");
    return { userId };
  },
});

export const connectionForAccount = internalQuery({
  args: { connectedAccountId: v.string() },
  handler: async (ctx, { connectedAccountId }) => ctx.db.query("gmailConnections")
    .withIndex("by_connected_account", q => q.eq("connectedAccountId", connectedAccountId)).unique(),
});

export const register = internalMutation({
  args: {
    spaceId: v.id("spaces"), userId: v.id("users"), connectedAccountId: v.string(),
    alias: v.string(), email: v.optional(v.string()), triggerId: v.string(),
  },
  returns: v.id("gmailConnections"),
  handler: async (ctx, args) => {
    const principal = await requireSpacePermission(ctx, args.spaceId, "read");
    if (principal.userId !== args.userId) throw new ConvexError({ code: "FORBIDDEN", message: "This Gmail connection belongs to another user" });
    const existing = await ctx.db.query("gmailConnections").withIndex("by_connected_account", q => q.eq("connectedAccountId", args.connectedAccountId)).unique();
    if (existing) {
      if (existing.userId !== args.userId || existing.spaceId !== args.spaceId) throw new ConvexError({ code: "FORBIDDEN", message: "This Gmail account is already assigned elsewhere" });
      return existing._id;
    }
    await ensurePersonalRoomForUser(ctx, args.spaceId, args.userId);
    const connectionId = await ctx.db.insert("gmailConnections", { ...args, status: "active", createdAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.gmail.backfill, { connectionId });
    return connectionId;
  },
});

export const connectionForProcessing = internalQuery({
  args: { connectionId: v.id("gmailConnections") },
  handler: async (ctx, { connectionId }) => ctx.db.get(connectionId),
});

export const saveClassification = internalMutation({
  args: {
    connectionId: v.id("gmailConnections"), externalMessageId: v.string(), threadId: v.string(),
    sender: v.string(), subject: v.string(), text: v.string(), receivedAt: v.number(), useful: v.boolean(),
    summary: v.string(), category,
  },
  returns: v.union(v.id("inboxItems"), v.null()),
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status !== "active") return null;
    const existing = await ctx.db.query("gmailProcessedMessages").withIndex("by_connection_message", q =>
      q.eq("connectionId", args.connectionId).eq("externalMessageId", args.externalMessageId),
    ).unique();
    if (existing) return null;
    await ctx.db.insert("gmailProcessedMessages", { connectionId: args.connectionId, externalMessageId: args.externalMessageId, useful: args.useful, processedAt: Date.now() });
    await ctx.db.patch(connection._id, { lastSyncedAt: Date.now() });
    if (!args.useful) return null;
    const roomId = await ensurePersonalRoomForUser(ctx, connection.spaceId, connection.userId);
    const inboxItemId = await ctx.db.insert("inboxItems", {
      spaceId: connection.spaceId,
      roomId,
      agentmailMessageId: `gmail:${connection.connectedAccountId}:${args.externalMessageId}`,
      agentmailThreadId: `gmail:${connection.connectedAccountId}:${args.threadId}`,
      sender: args.sender,
      subject: args.subject,
      originalText: args.text,
      visibility: "private",
      privateOwnerId: connection.userId,
      category: args.category,
      status: "ready",
      receivedAt: args.receivedAt,
    });
    await ctx.db.insert("messages", {
      spaceId: connection.spaceId,
      roomId,
      actorType: "email_guest",
      origin: "assistant",
      originalText: `Useful email from ${args.sender}\n\n${args.subject}\n\n${args.summary}`,
      language: "en",
      idempotencyKey: `gmail:${connection.connectedAccountId}:${args.externalMessageId}`,
      createdAt: args.receivedAt,
    });
    await ctx.db.insert("auditEvents", {
      spaceId: connection.spaceId,
      actorUserId: connection.userId,
      action: "gmail.useful_email_added",
      resourceType: "inboxItem",
      resourceId: String(inboxItemId),
      createdAt: Date.now(),
    });
    return inboxItemId;
  },
});
