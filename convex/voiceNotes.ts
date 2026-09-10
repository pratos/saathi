import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalAction, internalMutation, mutation, query } from "./_generated/server";
import { requireRoomPermission } from "./lib/authz";

const MAX_DURATION_MS = 30_000;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set([
  "audio/aac",
  "audio/flac",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-wav",
]);

const limits = new RateLimiter(components.rateLimiter, {
  createUpload: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 3 },
  transcribe: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 3 },
});

const voiceNoteView = v.object({
  _id: v.id("voiceNotes"),
  messageId: v.id("messages"),
  audioUrl: v.union(v.string(), v.null()),
  mediaType: v.string(),
  durationMs: v.number(),
  status: v.union(v.literal("pending"), v.literal("transcribing"), v.literal("ready"), v.literal("failed")),
  transcript: v.union(v.string(), v.null()),
  detectedLanguage: v.union(v.string(), v.null()),
});

export const generateUploadUrl = mutation({
  args: { roomId: v.id("rooms") },
  returns: v.string(),
  handler: async (ctx, { roomId }) => {
    const { userId } = await requireRoomPermission(ctx, roomId, "post_message");
    const rate = await limits.limit(ctx, "createUpload", { key: String(userId) });
    if (!rate.ok) throw new ConvexError({ code: "RATE_LIMITED", retryAfter: rate.retryAfter });
    return ctx.storage.generateUploadUrl();
  },
});

export const submit = mutation({
  args: {
    roomId: v.id("rooms"),
    storageId: v.id("_storage"),
    durationMs: v.number(),
    clientOperationId: v.string(),
  },
  returns: v.object({ messageId: v.id("messages"), voiceNoteId: v.id("voiceNotes") }),
  handler: async (ctx, args) => {
    const { userId, room } = await requireRoomPermission(ctx, args.roomId, "post_message");
    if (!Number.isFinite(args.durationMs) || args.durationMs < 250 || args.durationMs > MAX_DURATION_MS) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Voice notes must be 30 seconds or shorter" });
    }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(args.clientOperationId)) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid client operation ID" });
    }

    const existing = await ctx.db.query("messages").withIndex("by_room_idempotency", q =>
      q.eq("roomId", args.roomId).eq("idempotencyKey", args.clientOperationId),
    ).unique();
    if (existing) {
      if (existing.authorUserId !== userId) throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT", message: "Operation ID already used" });
      const voiceNote = await ctx.db.query("voiceNotes").withIndex("by_message", q => q.eq("messageId", existing._id)).unique();
      if (!voiceNote) throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT", message: "Operation ID already used for another message type" });
      return { messageId: existing._id, voiceNoteId: voiceNote._id };
    }

    const metadata = await ctx.db.system.get("_storage", args.storageId);
    const mediaType = metadata?.contentType?.split(";", 1)[0]?.toLowerCase();
    if (!metadata || !mediaType || !ALLOWED_MEDIA_TYPES.has(mediaType) || metadata.size <= 0 || metadata.size > MAX_SIZE_BYTES) {
      if (metadata) await ctx.storage.delete(args.storageId);
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Unsupported or oversized voice note" });
    }
    const rate = await limits.limit(ctx, "transcribe", { key: String(userId) });
    if (!rate.ok) {
      await ctx.storage.delete(args.storageId);
      throw new ConvexError({ code: "RATE_LIMITED", retryAfter: rate.retryAfter });
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      spaceId: room.spaceId,
      roomId: args.roomId,
      authorUserId: userId,
      actorType: "user",
      origin: "app",
      originalText: "[Voice note]",
      language: "en",
      idempotencyKey: args.clientOperationId,
      createdAt: now,
    });
    const voiceNoteId = await ctx.db.insert("voiceNotes", {
      spaceId: room.spaceId,
      roomId: args.roomId,
      messageId,
      authorUserId: userId,
      storageId: args.storageId,
      mediaType,
      sizeBytes: metadata.size,
      durationMs: Math.round(args.durationMs),
      status: "pending",
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.voiceNotes.transcribe, { voiceNoteId });
    return { messageId, voiceNoteId };
  },
});

export const getByMessage = query({
  args: { messageId: v.id("messages") },
  returns: v.union(voiceNoteView, v.null()),
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (!message) return null;
    await requireRoomPermission(ctx, message.roomId, "read");
    const voiceNote = await ctx.db.query("voiceNotes").withIndex("by_message", q => q.eq("messageId", messageId)).unique();
    if (!voiceNote) return null;
    return {
      _id: voiceNote._id,
      messageId: voiceNote.messageId,
      audioUrl: await ctx.storage.getUrl(voiceNote.storageId),
      mediaType: voiceNote.mediaType,
      durationMs: voiceNote.durationMs,
      status: voiceNote.status,
      transcript: voiceNote.transcript ?? null,
      detectedLanguage: voiceNote.detectedLanguage ?? null,
    };
  },
});

export const transcribe = internalAction({
  args: { voiceNoteId: v.id("voiceNotes") },
  returns: v.null(),
  handler: async (ctx, { voiceNoteId }): Promise<null> => {
    const details: { storageId: Id<"_storage">; mediaType: string } | null = await ctx.runMutation(
      internal.voiceNotes.markTranscribing,
      { voiceNoteId },
    );
    if (!details) return null;

    try {
      const audio = await ctx.storage.get(details.storageId);
      if (!audio) throw new Error("AUDIO_MISSING");
      const form = new FormData();
      form.append("file", new File([audio], `voice-note.${extensionFor(details.mediaType)}`, { type: details.mediaType }));
      form.append("model", "saaras:v3");
      form.append("mode", "codemix");

      const response = await fetch("https://api.sarvam.ai/speech-to-text", {
        method: "POST",
        headers: { "api-subscription-key": env.SARVAM_API_KEY },
        body: form,
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`SARVAM_${response.status}`);
      const payload: unknown = await response.json();
      if (!isTranscription(payload)) throw new Error("INVALID_PROVIDER_RESPONSE");
      await ctx.runMutation(internal.voiceNotes.completeTranscription, {
        voiceNoteId,
        transcript: payload.transcript.trim(),
        detectedLanguage: payload.language_code ?? null,
      });
    } catch (error) {
      const failureCode = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "TRANSCRIPTION_FAILED";
      await ctx.runMutation(internal.voiceNotes.failTranscription, { voiceNoteId, failureCode });
    }
    return null;
  },
});

export const markTranscribing = internalMutation({
  args: { voiceNoteId: v.id("voiceNotes") },
  returns: v.union(v.object({ storageId: v.id("_storage"), mediaType: v.string() }), v.null()),
  handler: async (ctx, { voiceNoteId }) => {
    const voiceNote = await ctx.db.get(voiceNoteId);
    if (!voiceNote || voiceNote.status !== "pending") return null;
    await ctx.db.patch(voiceNoteId, { status: "transcribing", failureCode: undefined });
    return { storageId: voiceNote.storageId, mediaType: voiceNote.mediaType };
  },
});

export const completeTranscription = internalMutation({
  args: {
    voiceNoteId: v.id("voiceNotes"),
    transcript: v.string(),
    detectedLanguage: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const voiceNote = await ctx.db.get(args.voiceNoteId);
    if (!voiceNote) return null;
    const transcript = args.transcript.trim();
    if (!transcript) throw new Error("Transcription was empty");
    const language = args.detectedLanguage?.startsWith("hi") ? "hi"
      : args.detectedLanguage?.startsWith("mr") ? "mr"
        : "en";
    await ctx.db.patch(voiceNote.messageId, { originalText: transcript, language });
    await ctx.db.patch(voiceNote._id, {
      status: "ready",
      transcript,
      detectedLanguage: args.detectedLanguage ?? undefined,
      failureCode: undefined,
      completedAt: Date.now(),
    });
    await ctx.db.insert("usageLedger", {
      spaceId: voiceNote.spaceId,
      userId: voiceNote.authorUserId,
      provider: "sarvam",
      model: "saaras:v3",
      unit: "audio_hour",
      quantity: voiceNote.durationMs / 3_600_000,
      costClass: "voice_transcription",
      createdAt: Date.now(),
    });
    return null;
  },
});

export const failTranscription = internalMutation({
  args: { voiceNoteId: v.id("voiceNotes"), failureCode: v.string() },
  returns: v.null(),
  handler: async (ctx, { voiceNoteId, failureCode }) => {
    const voiceNote = await ctx.db.get(voiceNoteId);
    if (!voiceNote || voiceNote.status === "ready") return null;
    await ctx.db.patch(voiceNoteId, { status: "failed", failureCode, completedAt: Date.now() });
    await ctx.db.insert("auditEvents", {
      spaceId: voiceNote.spaceId,
      actorUserId: voiceNote.authorUserId,
      action: "voice_note.transcription_failed",
      resourceType: "voiceNote",
      resourceId: String(voiceNoteId),
      metadata: { failureCode },
      createdAt: Date.now(),
    });
    return null;
  },
});

function isTranscription(value: unknown): value is { transcript: string; language_code: string | null } {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.transcript === "string"
    && payload.transcript.trim().length > 0
    && (typeof payload.language_code === "string" || payload.language_code === null);
}

function extensionFor(mediaType: string) {
  if (mediaType === "audio/mp4") return "m4a";
  if (mediaType === "audio/ogg") return "ogg";
  if (mediaType === "audio/mpeg") return "mp3";
  if (mediaType.includes("wav")) return "wav";
  return "webm";
}
