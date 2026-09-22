import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireInboxItemPermission, requireRoomPermission, requireSpacePermission } from "./lib/authz";
import type { GmailUsefulCategory } from "./lib/emailTaxonomy";
import { parseGmailSourceKey } from "./lib/gmailAttachments";
import { isUnexpiredOtp, OTP_SHARE_TTL_MS } from "./lib/otpSharing";
import { ensurePersonalRoomForUser } from "./rooms";

const category = v.union(
  v.literal("bills"), v.literal("school"), v.literal("travel"), v.literal("appointments"),
  v.literal("subscriptions"), v.literal("home"), v.literal("receipts"), v.literal("bank"), v.literal("security"),
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

export const connectionsForAccount = internalQuery({
  args: { connectedAccountId: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, { connectedAccountId }) => ctx.db.query("gmailConnections")
    .withIndex("by_connected_account", q => q.eq("connectedAccountId", connectedAccountId)).take(20),
});

export const attachmentSource = internalQuery({
  args: { inboxItemId: v.id("inboxItems") },
  returns: v.union(v.object({
    connectedAccountId: v.string(),
    messageId: v.string(),
    userId: v.id("users"),
    subject: v.string(),
    originalText: v.string(),
  }), v.null()),
  handler: async (ctx, { inboxItemId }) => {
    const item = await ctx.db.get(inboxItemId);
    if (!item) return null;
    const source = parseGmailSourceKey(item.agentmailMessageId);
    if (!source) return null;
    const connection = await ctx.db.query("gmailConnections")
      .withIndex("by_connected_account_space", q => q.eq("connectedAccountId", source.connectedAccountId).eq("spaceId", item.spaceId))
      .unique();
    if (!connection || connection.status !== "active"
      || (item.privateOwnerId && connection.userId !== item.privateOwnerId)) return null;
    return {
      ...source,
      userId: connection.userId,
      subject: item.subject,
      originalText: item.originalText,
    };
  },
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
    const existing = await ctx.db.query("gmailConnections").withIndex("by_connected_account_space", q => q.eq("connectedAccountId", args.connectedAccountId).eq("spaceId", args.spaceId)).unique();
    if (existing) {
      if (existing.userId !== args.userId) throw new ConvexError({ code: "FORBIDDEN", message: "This Gmail account is already assigned elsewhere" });
      return existing._id;
    }
    const siblings = await ctx.db.query("gmailConnections").withIndex("by_connected_account", q => q.eq("connectedAccountId", args.connectedAccountId)).take(20);
    if (siblings.some(row => row.userId !== args.userId)) {
      throw new ConvexError({ code: "FORBIDDEN", message: "This Gmail account is already assigned elsewhere" });
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

export const reusable = query({
  args: { spaceId: v.id("spaces") },
  returns: v.array(v.object({
    connectedAccountId: v.string(),
    email: v.optional(v.string()),
    alias: v.string(),
  })),
  handler: async (ctx, { spaceId }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "read");
    const here = await ctx.db.query("gmailConnections").withIndex("by_space_user", q => q.eq("spaceId", spaceId).eq("userId", userId)).take(20);
    const hereIds = new Set(here.map(row => row.connectedAccountId));
    const memberships = await ctx.db.query("memberships").withIndex("by_user_status", q => q.eq("userId", userId).eq("status", "active")).take(20);
    const found = new Map<string, { connectedAccountId: string; email?: string; alias: string }>();
    for (const membership of memberships) {
      if (membership.spaceId === spaceId) continue;
      const rows = await ctx.db.query("gmailConnections").withIndex("by_space_user", q => q.eq("spaceId", membership.spaceId).eq("userId", userId)).take(20);
      for (const row of rows) {
        if (row.status !== "active" || hereIds.has(row.connectedAccountId) || found.has(row.connectedAccountId)) continue;
        found.set(row.connectedAccountId, { connectedAccountId: row.connectedAccountId, email: row.email, alias: row.alias });
      }
    }
    return [...found.values()];
  },
});

export const enableForSpace = mutation({
  args: { spaceId: v.id("spaces"), connectedAccountId: v.string() },
  returns: v.id("gmailConnections"),
  handler: async (ctx, { spaceId, connectedAccountId }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "read");
    if (!/^ca_[A-Za-z0-9_-]{3,200}$/.test(connectedAccountId)) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid Gmail connection" });
    }
    const existing = await ctx.db.query("gmailConnections").withIndex("by_connected_account_space", q => q.eq("connectedAccountId", connectedAccountId).eq("spaceId", spaceId)).unique();
    if (existing) {
      if (existing.userId !== userId) throw new ConvexError({ code: "FORBIDDEN", message: "This Gmail account is already assigned elsewhere" });
      return existing._id;
    }
    const siblings = await ctx.db.query("gmailConnections").withIndex("by_connected_account", q => q.eq("connectedAccountId", connectedAccountId)).take(20);
    const template = siblings.find(row => row.userId === userId && row.status === "active");
    if (!template) throw new ConvexError({ code: "NOT_FOUND", message: "Connect Gmail once before adding it to another family" });
    if (siblings.some(row => row.userId !== userId)) {
      throw new ConvexError({ code: "FORBIDDEN", message: "This Gmail account is already assigned elsewhere" });
    }
    await ensurePersonalRoomForUser(ctx, spaceId, userId);
    const connectionId = await ctx.db.insert("gmailConnections", {
      spaceId, userId, connectedAccountId,
      alias: template.alias, email: template.email, triggerId: template.triggerId,
      status: "active", createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.gmail.backfill, { connectionId });
    return connectionId;
  },
});

export const disableForSpace = mutation({
  args: { spaceId: v.id("spaces"), connectedAccountId: v.string() },
  returns: v.null(),
  handler: async (ctx, { spaceId, connectedAccountId }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "read");
    const existing = await ctx.db.query("gmailConnections").withIndex("by_connected_account_space", q => q.eq("connectedAccountId", connectedAccountId).eq("spaceId", spaceId)).unique();
    if (!existing || existing.userId !== userId) return null;
    await ctx.db.delete(existing._id);
    return null;
  },
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

export const otpSharingPolicy = internalQuery({
  args: { connectionId: v.id("gmailConnections") },
  returns: v.boolean(),
  handler: async (ctx, { connectionId }) => {
    const connection = await ctx.db.get(connectionId);
    if (!connection || connection.status !== "active") return false;
    const space = await ctx.db.get(connection.spaceId);
    return space?.otpSharingEnabled !== false;
  },
});

export const saveClassification = internalMutation({
  args: {
    connectionId: v.id("gmailConnections"), externalMessageId: v.string(), threadId: v.string(),
    sender: v.string(), subject: v.string(), text: v.string(), html: v.optional(v.string()), receivedAt: v.number(), useful: v.boolean(),
    summary: v.string(), category, amount: v.optional(v.string()), merchant: v.optional(v.string()), otpCode: v.optional(v.string()),
  },
  returns: v.union(v.id("inboxItems"), v.null()),
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status !== "active") return null;
    const existing = await ctx.db.query("gmailProcessedMessages").withIndex("by_connection_message", q =>
      q.eq("connectionId", args.connectionId).eq("externalMessageId", args.externalMessageId),
    ).unique();
    if (existing) return null;
    const now = Date.now();
    const space = await ctx.db.get(connection.spaceId);
    const isOtp = space?.otpSharingEnabled !== false
      && args.category === "security"
      && Boolean(args.otpCode)
      && isUnexpiredOtp(args.receivedAt, now);
    const useful = args.useful && (args.category !== "security" || isOtp);
    await ctx.db.insert("gmailProcessedMessages", { connectionId: args.connectionId, externalMessageId: args.externalMessageId, useful, processedAt: now });
    if (!useful) return null;
    const roomId = await ensurePersonalRoomForUser(ctx, connection.spaceId, connection.userId);
    const ephemeralExpiresAt = isOtp ? now + OTP_SHARE_TTL_MS : undefined;
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
      subcategory: isOtp ? "otp" : undefined,
      status: isOtp ? "ready" : "received",
      extractedAmount: args.amount,
      extractedMerchant: args.merchant,
      extractedOtpCode: isOtp ? args.otpCode : undefined,
      ephemeralExpiresAt,
      receivedAt: args.receivedAt,
    });
    const sourceMessageId = await ctx.db.insert("messages", {
      spaceId: connection.spaceId,
      roomId,
      actorType: "email_guest",
      origin: "assistant",
      originalText: isOtp ? otpMessageText(args.sender, args.otpCode!) : moneyReviewText(args),
      language: "en",
      idempotencyKey: `gmail:${connection.connectedAccountId}:${args.externalMessageId}`,
      createdAt: args.receivedAt,
    });
    await ctx.db.patch(inboxItemId, { sourceMessageId });
    await ctx.db.insert("auditEvents", {
      spaceId: connection.spaceId,
      actorUserId: connection.userId,
      action: "gmail.useful_email_added",
      resourceType: "inboxItem",
      resourceId: String(inboxItemId),
      createdAt: now,
    });
    if (ephemeralExpiresAt) {
      await ctx.scheduler.runAt(ephemeralExpiresAt, internal.gmailData.expireOtp, { inboxItemId, expiresAt: ephemeralExpiresAt });
    } else {
      await ctx.scheduler.runAfter(0, internal.inboxWorkflow.enqueue, { inboxItemId });
    }
    return inboxItemId;
  },
});

export const pendingForRoom = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const { userId, room } = await requireRoomPermission(ctx, roomId, "read");
    if (room.type !== "private" || room.personalOwnerId !== userId) return [];
    const items = await ctx.db.query("inboxItems").withIndex("by_space_received", q => q.eq("spaceId", room.spaceId)).order("desc").take(40);
    return items.filter(item => item.privateOwnerId === userId && parseGmailSourceKey(item.agentmailMessageId));
  },
});

export const expireOtp = internalMutation({
  args: { inboxItemId: v.id("inboxItems"), expiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { inboxItemId, expiresAt }) => {
    const item = await ctx.db.get(inboxItemId);
    if (!item || item.ephemeralExpiresAt !== expiresAt || expiresAt > Date.now()) return null;
    if (item.sourceMessageId) await ctx.db.delete(item.sourceMessageId);
    if (item.sharedMessageId && item.sharedMessageId !== item.sourceMessageId) await ctx.db.delete(item.sharedMessageId);
    if (item.heartbeatMessageId && item.heartbeatMessageId !== item.sourceMessageId && item.heartbeatMessageId !== item.sharedMessageId) {
      await ctx.db.delete(item.heartbeatMessageId);
    }
    await ctx.db.delete(item._id);
    return null;
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
    await requireRoomPermission(ctx, familyRoom._id, "post_message");
    const now = Date.now();
    if (item.category === "security") {
      const space = await ctx.db.get(item.spaceId);
      if (space?.otpSharingEnabled === false) {
        throw new ConvexError({ code: "OTP_SHARING_DISABLED", message: "This family has disabled one-time-code sharing" });
      }
      if (!item.extractedOtpCode || !item.ephemeralExpiresAt || item.ephemeralExpiresAt <= now) {
        throw new ConvexError({ code: "OTP_EXPIRED", message: "This one-time code has expired" });
      }
      const sharedMessageId = await ctx.db.insert("messages", {
        spaceId: item.spaceId,
        roomId: familyRoom._id,
        actorType: "email_guest",
        origin: "assistant",
        originalText: otpSharedMessageText(item.sender, item.extractedOtpCode),
        language: "en",
        idempotencyKey: `gmail-otp-shared:${item.agentmailMessageId}`,
        createdAt: now,
      });
      await ctx.db.patch(item._id, {
        visibility: "space",
        sharedAt: now,
        sharedByUserId: userId,
        roomId: familyRoom._id,
        sharedMessageId,
        subject: "Shared one-time code",
        originalText: otpSharedMessageText(item.sender, item.extractedOtpCode),
        originalHtml: undefined,
      });
      await ctx.scheduler.runAt(item.ephemeralExpiresAt, internal.gmailData.expireOtp, {
        inboxItemId: item._id, expiresAt: item.ephemeralExpiresAt,
      });
      return item._id;
    }
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

export const shareWithSpace = mutation({
  args: { inboxItemId: v.id("inboxItems"), spaceId: v.id("spaces") },
  returns: v.id("inboxItems"),
  handler: async (ctx, { inboxItemId, spaceId }) => {
    const { userId, item } = await requireInboxItemPermission(ctx, inboxItemId, "read");
    if (item.privateOwnerId !== userId || !parseGmailSourceKey(item.agentmailMessageId)) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only you can share this email with another family" });
    }
    if (spaceId === item.spaceId) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Share this email into the current family inbox from My Saathi" });
    }
    if (item.forwardedSpaceIds?.includes(spaceId)) {
      const existing = await ctx.db.query("inboxItems").withIndex("by_space_agentmail_message", q => q.eq("spaceId", spaceId).eq("agentmailMessageId", item.agentmailMessageId)).unique();
      if (existing) return existing._id;
    }
    const { room: familyRoom } = await requireFamilyShareRoom(ctx, spaceId);
    const duplicate = await ctx.db.query("inboxItems").withIndex("by_space_agentmail_message", q => q.eq("spaceId", spaceId).eq("agentmailMessageId", item.agentmailMessageId)).unique();
    if (duplicate) {
      await ctx.db.patch(item._id, { forwardedSpaceIds: uniqueSpaceIds([...(item.forwardedSpaceIds ?? []), spaceId]) });
      return duplicate._id;
    }
    const now = Date.now();
    if (item.category === "security") {
      const targetSpace = await ctx.db.get(spaceId);
      if (targetSpace?.otpSharingEnabled === false) {
        throw new ConvexError({ code: "OTP_SHARING_DISABLED", message: "That family has disabled one-time-code sharing" });
      }
      if (!item.extractedOtpCode || !item.ephemeralExpiresAt || item.ephemeralExpiresAt <= now) {
        throw new ConvexError({ code: "OTP_EXPIRED", message: "This one-time code has expired" });
      }
      const copyId = await ctx.db.insert("inboxItems", {
        spaceId,
        roomId: familyRoom._id,
        agentmailMessageId: item.agentmailMessageId,
        agentmailThreadId: item.agentmailThreadId,
        sender: item.sender,
        subject: "Shared one-time code",
        originalText: otpSharedMessageText(item.sender, item.extractedOtpCode),
        visibility: "space",
        category: "security",
        subcategory: item.subcategory ?? "otp",
        status: "ready",
        extractedOtpCode: item.extractedOtpCode,
        ephemeralExpiresAt: item.ephemeralExpiresAt,
        sharedAt: now,
        sharedByUserId: userId,
        receivedAt: item.receivedAt,
      });
      const sharedMessageId = await ctx.db.insert("messages", {
        spaceId,
        roomId: familyRoom._id,
        actorType: "email_guest",
        origin: "assistant",
        originalText: otpSharedMessageText(item.sender, item.extractedOtpCode),
        language: "en",
        idempotencyKey: `gmail-otp-shared:${spaceId}:${item.agentmailMessageId}`,
        createdAt: now,
      });
      await ctx.db.patch(copyId, { sharedMessageId });
      await ctx.db.patch(item._id, { forwardedSpaceIds: uniqueSpaceIds([...(item.forwardedSpaceIds ?? []), spaceId]) });
      await ctx.scheduler.runAt(item.ephemeralExpiresAt, internal.gmailData.expireOtp, {
        inboxItemId: copyId, expiresAt: item.ephemeralExpiresAt,
      });
      return copyId;
    }
    const copyId = await ctx.db.insert("inboxItems", {
      spaceId,
      roomId: familyRoom._id,
      agentmailMessageId: item.agentmailMessageId,
      agentmailThreadId: item.agentmailThreadId,
      sender: item.sender,
      subject: item.subject,
      originalText: item.originalText,
      originalHtml: item.originalHtml,
      detectedLanguage: item.detectedLanguage,
      visibility: "space",
      category: item.category,
      subcategory: item.subcategory,
      status: item.status === "failed" ? "received" : item.status,
      extractedAmount: item.extractedAmount,
      extractedDueAt: item.extractedDueAt,
      extractedMerchant: item.extractedMerchant,
      extractedPeriod: item.extractedPeriod,
      extractedAmountInr: item.extractedAmountInr,
      extractedAmountUsd: item.extractedAmountUsd,
      direction: item.direction,
      processingNotes: item.processingNotes,
      documentParseStatus: item.documentParseStatus,
      suggestedActions: item.suggestedActions,
      actionStatus: item.actionStatus,
      sharedAt: now,
      sharedByUserId: userId,
      receivedAt: item.receivedAt,
    });
    await ctx.db.insert("messages", {
      spaceId,
      roomId: familyRoom._id,
      actorType: "email_guest",
      origin: "assistant",
      originalText: `Shared from My Saathi\n\n${item.subject}\nFrom ${item.sender}${item.extractedAmount ? `\nAmount: ${item.extractedAmount}` : ""}`,
      language: "en",
      idempotencyKey: `gmail-shared:${spaceId}:${item.agentmailMessageId}`,
      createdAt: now,
    });
    await ctx.db.patch(item._id, { forwardedSpaceIds: uniqueSpaceIds([...(item.forwardedSpaceIds ?? []), spaceId]) });
    await ctx.db.insert("auditEvents", {
      spaceId, actorUserId: userId, action: "gmail.shared_with_family",
      resourceType: "inboxItem", resourceId: String(copyId), createdAt: now,
    });
    return copyId;
  },
});

async function requireFamilyShareRoom(ctx: Parameters<typeof requireRoomPermission>[0], spaceId: import("./_generated/dataModel").Id<"spaces">) {
  await requireSpacePermission(ctx, spaceId, "read");
  const rooms = await ctx.db.query("rooms").withIndex("by_space", q => q.eq("spaceId", spaceId)).take(40);
  const familyRoom = rooms.find(room => room.type === "shared" && !room.archivedAt);
  if (!familyRoom) throw new ConvexError({ code: "NOT_FOUND", message: "This family does not have a shared conversation yet" });
  await requireRoomPermission(ctx, familyRoom._id, "post_message");
  return { room: familyRoom };
}

function uniqueSpaceIds(ids: Array<import("./_generated/dataModel").Id<"spaces">>) {
  return [...new Set(ids)];
}

function moneyReviewText(args: { sender: string; subject: string; summary: string; category: GmailUsefulCategory; amount?: string; merchant?: string }) {
  const kind: Record<GmailUsefulCategory, string> = {
    bills: "Bill",
    school: "School notice",
    travel: "Travel update",
    appointments: "Appointment",
    subscriptions: "Subscription",
    home: "Household notice",
    receipts: "Purchase",
    bank: "Bank notice",
    security: "Security code",
  };
  const amount = args.amount ? `\nAmount: ${args.amount}` : "";
  const merchant = args.merchant ? `\nMerchant: ${args.merchant}` : "";
  return `${kind[args.category]} from ${args.sender}\n\n${args.subject}${amount}${merchant}\n\n${args.summary}\n\nShare this with the family inbox if the household should track it.`;
}

function otpMessageText(sender: string, code: string) {
  return `One-time code from ${sender}\n\n${code}\n\nShare it only if a family member asked. Saathi deletes it after five minutes.`;
}

function otpSharedMessageText(sender: string, code: string) {
  return `One-time code from ${sender}\n\n${code}\n\nThis code is deleted from Saathi after five minutes.`;
}
