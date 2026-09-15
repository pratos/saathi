import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireRoomPermission, requireSpacePermission } from "./lib/authz";

const MAX_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set([
  "application/msword",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/gif",
  "image/heic",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/plain",
]);

const limits = new RateLimiter(components.rateLimiter, {
  createFileUpload: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 5 },
});

const attachmentView = v.object({
  _id: v.id("attachments"),
  messageId: v.id("messages"),
  fileName: v.string(),
  mediaType: v.string(),
  sizeBytes: v.number(),
  createdAt: v.number(),
  url: v.union(v.string(), v.null()),
});
const spaceAttachmentView = attachmentView.extend({ roomId: v.id("rooms"), roomTitle: v.string() });

export const generateUploadUrl = mutation({
  args: { roomId: v.id("rooms") },
  returns: v.string(),
  handler: async (ctx, { roomId }) => {
    const { userId } = await requireRoomPermission(ctx, roomId, "post_message");
    const rate = await limits.limit(ctx, "createFileUpload", { key: String(userId) });
    if (!rate.ok) throw new ConvexError({ code: "RATE_LIMITED", retryAfter: rate.retryAfter });
    return ctx.storage.generateUploadUrl();
  },
});

export const submit = mutation({
  args: {
    roomId: v.id("rooms"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mediaType: v.string(),
    clientOperationId: v.string(),
  },
  returns: v.object({ messageId: v.id("messages"), attachmentId: v.id("attachments") }),
  handler: async (ctx, args) => {
    const { userId, room } = await requireRoomPermission(ctx, args.roomId, "post_message");
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(args.clientOperationId)) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid client operation ID" });
    }

    const existing = await ctx.db.query("messages").withIndex("by_room_idempotency", q =>
      q.eq("roomId", args.roomId).eq("idempotencyKey", args.clientOperationId),
    ).unique();
    if (existing) {
      if (existing.authorUserId !== userId) throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT", message: "Operation ID already used" });
      const attachment = await ctx.db.query("attachments").withIndex("by_message", q => q.eq("messageId", existing._id)).unique();
      if (!attachment) throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT", message: "Operation ID already used for another message type" });
      if (attachment.storageId !== args.storageId) {
        const unusedUpload = await ctx.db.system.get("_storage", args.storageId);
        if (unusedUpload) await ctx.storage.delete(args.storageId);
      }
      return { messageId: existing._id, attachmentId: attachment._id };
    }

    const fileName = sanitizeFileName(args.fileName);
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    const mediaType = args.mediaType.split(";", 1)[0].trim().toLowerCase();
    const storedMediaType = metadata?.contentType?.split(";", 1)[0]?.toLowerCase();
    if (!metadata || !ALLOWED_MEDIA_TYPES.has(mediaType) || (storedMediaType && storedMediaType !== mediaType)
      || metadata.size <= 0 || metadata.size > MAX_SIZE_BYTES) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Use a supported image or document up to 20 MB" });
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      spaceId: room.spaceId,
      roomId: args.roomId,
      authorUserId: userId,
      actorType: "user",
      origin: "app",
      originalText: `[Attachment: ${fileName}]`,
      language: "en",
      idempotencyKey: args.clientOperationId,
      createdAt: now,
    });
    const attachmentId = await ctx.db.insert("attachments", {
      spaceId: room.spaceId,
      roomId: args.roomId,
      messageId,
      authorUserId: userId,
      storageId: args.storageId,
      fileName,
      mediaType,
      sizeBytes: metadata.size,
      createdAt: now,
    });
    return { messageId, attachmentId };
  },
});

export const forRoom = query({
  args: { roomId: v.id("rooms"), limit: v.optional(v.number()) },
  returns: v.array(attachmentView),
  handler: async (ctx, { roomId, limit }) => {
    await requireRoomPermission(ctx, roomId, "read");
    const attachments = await ctx.db.query("attachments")
      .withIndex("by_room_created", q => q.eq("roomId", roomId))
      .order("desc")
      .take(Math.min(Math.max(limit ?? 40, 1), 100));
    return Promise.all(attachments.map(async attachment => ({
      _id: attachment._id,
      messageId: attachment.messageId,
      fileName: attachment.fileName,
      mediaType: attachment.mediaType,
      sizeBytes: attachment.sizeBytes,
      createdAt: attachment.createdAt,
      url: await ctx.storage.getUrl(attachment.storageId),
    })));
  },
});

export const forSpace = query({
  args: { spaceId: v.id("spaces"), limit: v.optional(v.number()) },
  returns: v.array(spaceAttachmentView),
  handler: async (ctx, { spaceId, limit }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "read");
    const grants = await ctx.db.query("roomMembers").withIndex("by_user", q => q.eq("userId", userId)).collect();
    const rooms = await Promise.all(grants.map(grant => ctx.db.get(grant.roomId)));
    const allowedRooms = rooms.filter(room => room && room.spaceId === spaceId && !room.archivedAt);
    const perRoom = await Promise.all(allowedRooms.map(async room => {
      const attachments = await ctx.db.query("attachments").withIndex("by_room_created", q => q.eq("roomId", room!._id)).order("desc").take(40);
      return Promise.all(attachments.map(async attachment => ({
        _id: attachment._id,
        messageId: attachment.messageId,
        fileName: attachment.fileName,
        mediaType: attachment.mediaType,
        sizeBytes: attachment.sizeBytes,
        createdAt: attachment.createdAt,
        url: await ctx.storage.getUrl(attachment.storageId),
        roomId: room!._id,
        roomTitle: room!.type === "private" ? "My Saathi" : room!.title,
      })));
    }));
    return perRoom.flat().sort((left, right) => right.createdAt - left.createdAt).slice(0, Math.min(Math.max(limit ?? 40, 1), 100));
  },
});

function sanitizeFileName(value: string) {
  const fileName = [...value].map(character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || character === "/" || character === "\\" ? "_" : character;
  }).join("").trim();
  if (!fileName || fileName.length > 180) {
    throw new ConvexError({ code: "INVALID_ARGUMENT", message: "File name must be between 1 and 180 characters" });
  }
  return fileName;
}
