import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireInboxItemPermission, requireRoomPermission, requireSpacePermission } from "./lib/authz";
import { ensurePersonalRoomForUser } from "./rooms";

const category = v.union(
  v.literal("bills"), v.literal("receipts"), v.literal("bank"),
);

export const mine = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "read");
    const connections = await ctx.db.query("gmailConnections")
      .withIndex("by_space_user", q => q.eq("spaceId", spaceId).eq("userId", userId))
      .collect();
    return Promise.all(connections.map(async connection => {
      const syncState = await ctx.db.query("gmailConnectionSyncStates")
        .withIndex("by_connection_id", q => q.eq("connectionId", connection._id))
        .unique();
      return { ...connection, lastSyncedAt: syncState?.lastSyncedAt ?? connection.lastSyncedAt };
    }));
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

const gmailConnectionDoc = v.object({
  _id: v.id("gmailConnections"),
  _creationTime: v.number(),
  spaceId: v.id("spaces"),
  userId: v.id("users"),
  connectedAccountId: v.string(),
  alias: v.string(),
  email: v.optional(v.string()),
  triggerId: v.string(),
  status: v.union(v.literal("active"), v.literal("error")),
  createdAt: v.number(),
  lastSyncedAt: v.optional(v.number()),
});

export const mineInternal = internalQuery({
  args: { spaceId: v.id("spaces"), userId: v.id("users") },
  returns: v.array(gmailConnectionDoc),
  handler: async (ctx, { spaceId, userId }) => {
    const principal = await requireSpacePermission(ctx, spaceId, "read");
    if (principal.userId !== userId) throw new ConvexError({ code: "FORBIDDEN", message: "This Gmail list belongs to another user" });
    return ctx.db.query("gmailConnections").withIndex("by_space_user", q => q.eq("spaceId", spaceId).eq("userId", userId)).take(20);
  },
});

export const touchSynced = internalMutation({
  args: { connectionId: v.id("gmailConnections") },
  returns: v.null(),
  handler: async (ctx, { connectionId }) => {
    const lastSyncedAt = Date.now();
    const existing = await ctx.db.query("gmailConnectionSyncStates")
      .withIndex("by_connection_id", q => q.eq("connectionId", connectionId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { lastSyncedAt });
    else await ctx.db.insert("gmailConnectionSyncStates", { connectionId, lastSyncedAt });
    return null;
  },
});

export const connectionForProcessing = internalQuery({
  args: { connectionId: v.id("gmailConnections") },
  handler: async (ctx, { connectionId }) => ctx.db.get(connectionId),
});

export const saveClassification = internalMutation({
  args: {
    connectionId: v.id("gmailConnections"), externalMessageId: v.string(), threadId: v.string(),
    sender: v.string(), subject: v.string(), text: v.string(), html: v.optional(v.string()), receivedAt: v.number(), useful: v.boolean(),
    summary: v.string(), category, amount: v.optional(v.string()), merchant: v.optional(v.string()),
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
      originalHtml: args.html,
      visibility: "private",
      privateOwnerId: connection.userId,
      category: args.category,
      status: "received",
      extractedAmount: args.amount,
      extractedMerchant: args.merchant,
      receivedAt: args.receivedAt,
    });
    await ctx.db.insert("messages", {
      spaceId: connection.spaceId,
      roomId,
      actorType: "email_guest",
      origin: "assistant",
      originalText: moneyReviewText(args),
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
    await ctx.scheduler.runAfter(0, internal.inboxWorkflow.enqueue, { inboxItemId });
    return inboxItemId;
  },
});

export const pendingForRoom = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const { userId, room } = await requireRoomPermission(ctx, roomId, "read");
    if (room.type !== "private" || room.personalOwnerId !== userId) return [];
    const items = await ctx.db.query("inboxItems").withIndex("by_space_received", q => q.eq("spaceId", room.spaceId)).order("desc").take(40);
    return items.filter(item => item.visibility === "private" && item.privateOwnerId === userId && item.roomId === roomId && !item.sharedAt);
  },
});

export const shareWithFamily = mutation({
  args: { inboxItemId: v.id("inboxItems") },
  returns: v.id("inboxItems"),
  handler: async (ctx, { inboxItemId }) => {
    const { userId, item } = await requireInboxItemPermission(ctx, inboxItemId, "read");
    if (item.visibility !== "private" || item.privateOwnerId !== userId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only you can share this email with the family" });
    }
    if (item.sharedAt) return item._id;
    const familyRoom = await ctx.db.query("rooms").withIndex("by_space", q => q.eq("spaceId", item.spaceId))
      .filter(q => q.eq(q.field("type"), "shared")).first();
    if (!familyRoom) throw new ConvexError({ code: "NOT_FOUND", message: "This family does not have a shared conversation yet" });
    const now = Date.now();
    await ctx.db.patch(item._id, {
      visibility: "space", sharedAt: now, sharedByUserId: userId, roomId: familyRoom._id,
      status: item.documentParseStatus ? item.status : "received",
      heartbeatMessageId: undefined,
    });
    await ctx.db.insert("messages", {
      spaceId: item.spaceId,
      roomId: familyRoom._id,
      actorType: "email_guest",
      origin: "assistant",
      originalText: `Shared from My Saathi\n\n${item.subject}\nFrom ${item.sender}${item.extractedAmount ? `\nAmount: ${item.extractedAmount}` : ""}`,
      language: "en",
      idempotencyKey: `gmail-shared:${item.agentmailMessageId}`,
      createdAt: now,
    });
    if (isFoodMerchant(item.sender, item.subject, item.originalText) && item.extractedAmount) {
      const amount = parseAmount(item.extractedAmount);
      if (amount !== null) {
        const existingSpend = await ctx.db.query("familySpend").withIndex("by_source_inbox", q => q.eq("sourceInboxItemId", item._id)).unique();
        if (!existingSpend) {
          await ctx.db.insert("familySpend", {
            spaceId: item.spaceId,
            category: "food",
            amount,
            currency: "INR",
            merchant: foodMerchantName(item.sender, item.subject),
            sourceInboxItemId: item._id,
            createdBy: userId,
            spentAt: item.receivedAt,
          });
        }
      }
    }
    await ctx.db.insert("auditEvents", {
      spaceId: item.spaceId,
      actorUserId: userId,
      action: "gmail.shared_with_family",
      resourceType: "inboxItem",
      resourceId: String(item._id),
      createdAt: now,
    });
    if (!item.documentParseStatus || item.documentParseStatus === "none") {
      await ctx.scheduler.runAfter(0, internal.inboxWorkflow.enqueue, { inboxItemId: item._id });
    }
    return item._id;
  },
});

function moneyReviewText(args: { sender: string; subject: string; summary: string; category: "bills" | "receipts" | "bank"; amount?: string; merchant?: string }) {
  const kind = args.category === "bills" ? "Bill" : args.category === "bank" ? "Bank notice" : "Purchase";
  const amount = args.amount ? `\nAmount: ${args.amount}` : "";
  const merchant = args.merchant ? `\nMerchant: ${args.merchant}` : "";
  return `${kind} from ${args.sender}\n\n${args.subject}${amount}${merchant}\n\n${args.summary}\n\nShare this with the family inbox if the household should track it.`;
}

function isFoodMerchant(sender: string, subject: string, text: string) {
  return /swiggy|zomato|eatclub|foodpanda|uber\s*eats/i.test(`${sender} ${subject} ${text}`);
}

function foodMerchantName(sender: string, subject: string) {
  if (/swiggy/i.test(`${sender} ${subject}`)) return "Swiggy";
  if (/zomato/i.test(`${sender} ${subject}`)) return "Zomato";
  return "Food delivery";
}

function parseAmount(value: string) {
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
