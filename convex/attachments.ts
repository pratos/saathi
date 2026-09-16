import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireRoomPermission, requireSpacePermission } from "./lib/authz";
import { resolveOpenAiKey } from "./lib/providerKeys";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
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

const attachmentKind = v.union(v.literal("photo"), v.literal("receipt"), v.literal("document"));
const transcriptStatus = v.union(v.literal("pending"), v.literal("ready"), v.literal("failed"));
const attachmentView = v.object({
  _id: v.id("attachments"),
  messageId: v.id("messages"),
  fileName: v.string(),
  mediaType: v.string(),
  sizeBytes: v.number(),
  createdAt: v.number(),
  url: v.union(v.string(), v.null()),
  kind: v.optional(attachmentKind),
  transcriptStatus: v.optional(transcriptStatus),
  transcript: v.optional(v.string()),
  extractedAmount: v.optional(v.string()),
  extractedMerchant: v.optional(v.string()),
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
    capture: v.optional(v.union(v.literal("library"), v.literal("camera"), v.literal("receipt"))),
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
    const maxBytes = mediaType.startsWith("image/") ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
    if (!metadata || !ALLOWED_MEDIA_TYPES.has(mediaType) || (storedMediaType && storedMediaType !== mediaType)
      || metadata.size <= 0 || metadata.size > maxBytes) {
      throw new ConvexError({
        code: "INVALID_ARGUMENT",
        message: mediaType.startsWith("image/")
          ? "Use a supported image up to 20 MB"
          : "Use a supported document up to 50 MB",
      });
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
    const kind = attachmentKindFor(mediaType, args.capture);
    const shouldRead = kind === "photo" || kind === "receipt" || mediaType === "application/pdf";
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
      kind,
      transcriptStatus: shouldRead ? "pending" : undefined,
    });
    if (shouldRead) {
      await ctx.scheduler.runAfter(0, kind === "document" ? internal.attachments.readDocument : internal.attachments.readPhoto, { attachmentId });
    }
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
      kind: attachment.kind,
      transcriptStatus: attachment.transcriptStatus,
      transcript: attachment.transcript,
      extractedAmount: attachment.extractedAmount,
      extractedMerchant: attachment.extractedMerchant,
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
        kind: attachment.kind,
        transcriptStatus: attachment.transcriptStatus,
        transcript: attachment.transcript,
        extractedAmount: attachment.extractedAmount,
        extractedMerchant: attachment.extractedMerchant,
      })));
    }));
    return perRoom.flat().sort((left, right) => right.createdAt - left.createdAt).slice(0, Math.min(Math.max(limit ?? 40, 1), 100));
  },
});

export const readPhoto = internalAction({
  args: { attachmentId: v.id("attachments") },
  returns: v.null(),
  handler: async (ctx, { attachmentId }): Promise<null> => {
    const photo: { storageId: Id<"_storage">; mediaType: string; kind: "photo" | "receipt" | "document"; spaceId: Id<"spaces"> } | null =
      await ctx.runQuery(internal.attachments.loadPhotoRead, { attachmentId });
    if (!photo) return null;
    const apiKey = await resolveOpenAiKey(ctx, photo.spaceId);
    if (!apiKey) {
      await ctx.runMutation(internal.attachments.failPhotoRead, { attachmentId, error: "Photo reading needs OPENAI_API_KEY." });
      return null;
    }
    try {
      const bytes = await ctx.storage.get(photo.storageId);
      if (!bytes) throw new Error("The photo is no longer in storage.");
      const result = await interpretHouseholdPhoto(apiKey, photo.mediaType, bytes, photo.kind === "receipt");
      await ctx.runMutation(internal.attachments.savePhotoRead, {
        attachmentId,
        transcript: result.transcript,
        extractedAmount: result.amount,
        extractedMerchant: result.merchant,
        kind: result.looksLikeReceipt ? "receipt" : photo.kind,
      });
    } catch (error) {
      await ctx.runMutation(internal.attachments.failPhotoRead, {
        attachmentId,
        error: error instanceof Error ? error.message : "Could not read this photo.",
      });
    }
    return null;
  },
});

export const loadPhotoRead = internalQuery({
  args: { attachmentId: v.id("attachments") },
  returns: v.union(v.object({
    storageId: v.id("_storage"),
    mediaType: v.string(),
    kind: attachmentKind,
    spaceId: v.id("spaces"),
  }), v.null()),
  handler: async (ctx, { attachmentId }) => {
    const attachment = await ctx.db.get(attachmentId);
    if (!attachment || attachment.transcriptStatus !== "pending") return null;
    return {
      storageId: attachment.storageId,
      mediaType: attachment.mediaType,
      kind: attachment.kind ?? "photo",
      spaceId: attachment.spaceId,
    };
  },
});

export const savePhotoRead = internalMutation({
  args: {
    attachmentId: v.id("attachments"),
    transcript: v.string(),
    extractedAmount: v.optional(v.string()),
    extractedMerchant: v.optional(v.string()),
    kind: attachmentKind,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment) return null;
    await ctx.db.patch(args.attachmentId, {
      transcriptStatus: "ready",
      transcript: args.transcript.slice(0, 4_000),
      extractedAmount: args.extractedAmount,
      extractedMerchant: args.extractedMerchant,
      kind: args.kind,
    });
    if (args.kind === "receipt" && args.transcript) {
      await ctx.db.patch(attachment.messageId, {
        originalText: args.extractedMerchant
          ? `Receipt from ${args.extractedMerchant}${args.extractedAmount ? ` · ${args.extractedAmount}` : ""}`
          : args.transcript.slice(0, 280),
      });
    }
    return null;
  },
});

export const readDocument = internalAction({
  args: { attachmentId: v.id("attachments") },
  returns: v.null(),
  handler: async (ctx, { attachmentId }): Promise<null> => {
    const file: { storageId: Id<"_storage">; fileName: string; mediaType: string } | null =
      await ctx.runQuery(internal.attachments.loadDocumentRead, { attachmentId });
    if (!file) return null;
    try {
      const bytes = await ctx.storage.get(file.storageId);
      if (!bytes) throw new Error("The document is no longer in storage.");
      const markdown = await parseStoredPdf(file.fileName, bytes);
      if (!markdown) throw new Error("Could not read this PDF.");
      await ctx.runMutation(internal.attachments.savePhotoRead, {
        attachmentId,
        transcript: markdown.slice(0, 4_000),
        kind: "document",
      });
    } catch (error) {
      await ctx.runMutation(internal.attachments.failPhotoRead, {
        attachmentId,
        error: error instanceof Error ? error.message : "Could not read this document.",
      });
    }
    return null;
  },
});

export const loadDocumentRead = internalQuery({
  args: { attachmentId: v.id("attachments") },
  returns: v.union(v.object({
    storageId: v.id("_storage"),
    fileName: v.string(),
    mediaType: v.string(),
  }), v.null()),
  handler: async (ctx, { attachmentId }) => {
    const attachment = await ctx.db.get(attachmentId);
    if (!attachment || attachment.transcriptStatus !== "pending" || attachment.mediaType !== "application/pdf") return null;
    return { storageId: attachment.storageId, fileName: attachment.fileName, mediaType: attachment.mediaType };
  },
});

export const failPhotoRead = internalMutation({
  args: { attachmentId: v.id("attachments"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { attachmentId, error }) => {
    const attachment = await ctx.db.get(attachmentId);
    if (!attachment) return null;
    await ctx.db.patch(attachmentId, { transcriptStatus: "failed", transcript: error.slice(0, 280) });
    return null;
  },
});

async function interpretHouseholdPhoto(apiKey: string, mediaType: string, bytes: Blob, preferReceipt: boolean) {
  const buffer = new Uint8Array(await bytes.arrayBuffer());
  const image = `data:${mediaType};base64,${encodeBase64(buffer)}`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5-mini",
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: preferReceipt
              ? "Read this household photo. If it is a receipt, bill, or purchase slip, extract merchant, amount, date, and a one-line summary. If it is a family photo, write a short caption. Never invent card numbers. JSON only."
              : "Read this household photo. If it is a receipt or bill, extract merchant, amount, date, and a one-line summary. Otherwise write a short family-safe caption. JSON only.",
          },
          { type: "input_image", image_url: image },
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "household_photo_read",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["looksLikeReceipt", "transcript", "amount", "merchant"],
            properties: {
              looksLikeReceipt: { type: "boolean" },
              transcript: { type: "string" },
              amount: { type: ["string", "null"] },
              merchant: { type: ["string", "null"] },
            },
          },
        },
      },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Photo reading failed (${response.status}).`);
  const parsed = parsePhotoRead(await response.json());
  if (!parsed) throw new Error("Photo reading returned no usable text.");
  return parsed;
}

function parsePhotoRead(payload: unknown) {
  const text = extractOutputText(payload);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { looksLikeReceipt?: unknown; transcript?: unknown; amount?: unknown; merchant?: unknown };
    const transcript = typeof parsed.transcript === "string" ? parsed.transcript.trim() : "";
    if (!transcript) return null;
    return {
      looksLikeReceipt: parsed.looksLikeReceipt === true,
      transcript,
      amount: typeof parsed.amount === "string" && parsed.amount.trim() ? parsed.amount.trim() : undefined,
      merchant: typeof parsed.merchant === "string" && parsed.merchant.trim() ? parsed.merchant.trim() : undefined,
    };
  } catch {
    return { looksLikeReceipt: false, transcript: text, amount: undefined, merchant: undefined };
  }
}

function extractOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as Record<string, unknown>;
  if (typeof root.output_text === "string" && root.output_text.trim()) return root.output_text.trim();
  const output = Array.isArray(root.output) ? root.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) continue;
    for (const block of item.content) {
      if (block && typeof block === "object" && "text" in block && typeof block.text === "string" && block.text.trim()) {
        return block.text.trim();
      }
    }
  }
  return "";
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function parseStoredPdf(fileName: string, bytes: Blob) {
  const apiKey = env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("Document reading needs FIRECRAWL_API_KEY.");
  const form = new FormData();
  form.set("file", bytes, fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`);
  form.set("options", JSON.stringify({ formats: ["markdown"], parsers: [{ type: "pdf", mode: "auto", maxPages: 20 }] }));
  const response = await fetch("https://api.firecrawl.dev/v2/parse", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Document parsing failed (${response.status}).`);
  try {
    const markdown = JSON.parse(body) as { data?: { markdown?: unknown }; markdown?: unknown };
    const text = typeof markdown.data?.markdown === "string" ? markdown.data.markdown
      : typeof markdown.markdown === "string" ? markdown.markdown : "";
    return text.trim();
  } catch {
    return "";
  }
}

function attachmentKindFor(mediaType: string, capture?: "library" | "camera" | "receipt") {
  if (capture === "receipt") return "receipt" as const;
  if (mediaType.startsWith("image/")) return "photo" as const;
  return "document" as const;
}

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
