import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, env, internalMutation, internalQuery } from "./_generated/server";
import { CONVERSATION_ACTION_TOOLS } from "./conversationActions";
import { requireRoomPermission } from "./lib/authz";
import { GENERATE_IMAGE_TOOL } from "./lib/imageSafety";
import { resolveOpenAiKey } from "./lib/providerKeys";

const liveVoiceLimits = new RateLimiter(components.rateLimiter, {
  startLiveVoice: { kind: "fixed window", rate: 8, period: HOUR },
});

const historyItem = v.object({ role: v.union(v.literal("user"), v.literal("assistant")), text: v.string() });

export const startSession = action({
  args: { roomId: v.id("rooms"), sdp: v.string() },
  returns: v.object({ sessionId: v.string(), sdp: v.string() }),
  handler: async (ctx, { roomId, sdp }): Promise<{ sessionId: string; sdp: string }> => {
    if (!sdp.trim() || sdp.length > 100_000) throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid voice connection offer" });
    const prepared: { userId: Id<"users">; spaceId: Id<"spaces">; history: Array<{ role: "user" | "assistant"; text: string }> } =
      await ctx.runMutation(internal.liveVoice.prepare, { roomId });
    const apiKey = await resolveOpenAiKey(ctx, prepared.spaceId);
    if (!apiKey) throw new ConvexError({ code: "LIVE_VOICE_NOT_CONFIGURED", message: "Voice mode is not configured" });
    const safetyIdentifier = await sha256(String(prepared.userId));
    const response = await fetch("https://api.openai.com/v1/live/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": safetyIdentifier,
      },
      body: JSON.stringify({
        session: {
          model: "gpt-live-1",
          instructions: "You are Saathi, a warm, concise family assistant. Speak naturally in the language the caller uses. Help clarify and coordinate. Use the matching tool when the caller explicitly asks to change their reading language, default image style, family food budget, or family thinking level. Never claim an action succeeded until its tool confirms it. Ask for confirmation when a request is ambiguous or consequential. Use web search when current information is needed. If the caller explicitly asks for an image, infographic, or respectful devotional artwork, call generate_image. Never create sexual, nude, pornographic, or graphic violent images; refuse those requests.",
          input: prepared.history.map(item => ({
            type: "message",
            role: item.role,
            content: [{ type: item.role === "user" ? "input_text" : "output_text", text: item.text }],
          })),
          delegation: {
            type: "responses",
            responses: {
              model: "gpt-5-mini",
              instructions: "Use web search for current facts. Use a settings tool only when the caller explicitly requests that exact change. When the caller explicitly wants an image, infographic, or respectful devotional artwork, call generate_image. Never create sexual, nude, pornographic, or graphic violent images. Return concise, grounded results for a spoken family conversation.",
              tools: [{ type: "web_search" }, GENERATE_IMAGE_TOOL, ...CONVERSATION_ACTION_TOOLS],
              tool_choice: "auto",
            },
          },
        },
        transport: { type: "webrtc", sdp },
      }),
    });
    if (!response.ok) {
      console.error("GPT_LIVE_SESSION_REJECTED", response.status);
      throw new ConvexError({ code: "LIVE_VOICE_UNAVAILABLE", message: "Voice mode is unavailable right now" });
    }
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") throw invalidVoiceResponse();
    const result = payload as { session?: { id?: unknown }; transport?: { sdp?: unknown } };
    if (typeof result.session?.id !== "string" || typeof result.transport?.sdp !== "string") throw invalidVoiceResponse();
    await ctx.runMutation(internal.liveVoice.register, { roomId, sessionId: result.session.id });
    return { sessionId: result.session.id, sdp: result.transport.sdp };
  },
});

export const register = internalMutation({
  args: { roomId: v.id("rooms"), sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, { roomId, sessionId }) => {
    const { userId, room } = await requireRoomPermission(ctx, roomId, "post_message");
    const existing = await ctx.db.query("liveVoiceSessions").withIndex("by_session_id", q => q.eq("sessionId", sessionId)).unique();
    if (existing) throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT", message: "Voice session already exists" });
    await ctx.db.insert("liveVoiceSessions", { sessionId, spaceId: room.spaceId, roomId, startedBy: userId, createdAt: Date.now() });
    return null;
  },
});

export const prepare = internalMutation({
  args: { roomId: v.id("rooms") },
  returns: v.object({ userId: v.id("users"), spaceId: v.id("spaces"), history: v.array(historyItem) }),
  handler: async (ctx, { roomId }) => {
    const { userId, room } = await requireRoomPermission(ctx, roomId, "post_message");
    const limit = await liveVoiceLimits.limit(ctx, "startLiveVoice", { key: String(userId) });
    if (!limit.ok) throw new ConvexError({ code: "RATE_LIMITED", retryAfter: limit.retryAfter });
    const messages = await ctx.db.query("messages").withIndex("by_room_created", q => q.eq("roomId", roomId)).order("desc").take(16);
    return {
      userId,
      spaceId: room.spaceId,
      history: messages.reverse().filter(message => message.actorType !== "email_guest").map(message => ({
        role: message.actorType === "assistant" || (message.actorType === "voice_transcript" && message.voiceSpeaker === "assistant")
          ? "assistant" as const
          : "user" as const,
        text: message.originalText.slice(0, 2_000),
      })),
    };
  },
});

export const finishSession = action({
  args: {
    roomId: v.id("rooms"),
    sessionId: v.string(),
    turns: v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      text: v.string(),
      startMs: v.number(),
    })),
  },
  returns: v.union(v.literal("saved"), v.literal("already_saved")),
  handler: async (ctx, { roomId, sessionId, turns }): Promise<"saved" | "already_saved"> => {
    if (!/^live_[A-Za-z0-9_-]{3,120}$/.test(sessionId)) throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid voice session" });
    if (turns.length > 100) throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Voice transcript is too long" });
    const cleanedTurns = turns.map(turn => ({ ...turn, text: turn.text.trim() })).filter(turn => turn.text);
    if (cleanedTurns.some(turn => turn.text.length > 20_000 || !Number.isFinite(turn.startMs) || turn.startMs < 0)
      || cleanedTurns.reduce((length, turn) => length + turn.text.length, 0) > 40_000) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid voice transcript" });
    }
    const prepared: { alreadyFinished: boolean } = await ctx.runQuery(internal.liveVoice.prepareFinish, { roomId, sessionId });
    if (prepared.alreadyFinished) return "already_saved";
    const transcript = cleanedTurns.map(turn => `${turn.role === "user" ? "Caller" : "Saathi"}: ${turn.text}`).join("\n");
    const space: { spaceId: Id<"spaces"> } | null = await ctx.runQuery(internal.liveVoice.spaceForRoom, { roomId });
    const apiKey = space ? await resolveOpenAiKey(ctx, space.spaceId) : env.OPENAI_API_KEY?.trim();
    const summary = transcript
      ? await summarizeCall(transcript, apiKey)
      : "Voice call completed with Saathi.";
    return await ctx.runMutation(internal.liveVoice.storeSummary, { roomId, sessionId, summary });
  },
});

export const spaceForRoom = internalQuery({
  args: { roomId: v.id("rooms") },
  returns: v.union(v.object({ spaceId: v.id("spaces") }), v.null()),
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get(roomId);
    return room ? { spaceId: room.spaceId } : null;
  },
});

export const prepareFinish = internalQuery({
  args: { roomId: v.id("rooms"), sessionId: v.string() },
  returns: v.object({ alreadyFinished: v.boolean() }),
  handler: async (ctx, { roomId, sessionId }) => {
    const { userId } = await requireRoomPermission(ctx, roomId, "post_message");
    const session = await ctx.db.query("liveVoiceSessions").withIndex("by_session_id", q => q.eq("sessionId", sessionId)).unique();
    if (!session || session.roomId !== roomId || session.startedBy !== userId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "This voice session does not belong to you" });
    }
    return { alreadyFinished: session.finishedAt !== undefined };
  },
});

export const storeSummary = internalMutation({
  args: { roomId: v.id("rooms"), sessionId: v.string(), summary: v.string() },
  returns: v.union(v.literal("saved"), v.literal("already_saved")),
  handler: async (ctx, { roomId, sessionId, summary }) => {
    const { room, userId } = await requireRoomPermission(ctx, roomId, "post_message");
    const session = await ctx.db.query("liveVoiceSessions").withIndex("by_session_id", q => q.eq("sessionId", sessionId)).unique();
    if (!session || session.roomId !== roomId || session.startedBy !== userId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "This voice session does not belong to you" });
    }
    if (session.finishedAt) return "already_saved";
    await ctx.db.insert("messages", {
      spaceId: room.spaceId,
      roomId,
      authorUserId: userId,
      actorType: "voice_transcript",
      origin: "app",
      originalText: summary.trim().slice(0, 2_000),
      language: "en",
      idempotencyKey: `live-summary:${sessionId}`,
      createdAt: Date.now(),
    });
    await ctx.db.patch(session._id, { finishedAt: Date.now() });
    return "saved";
  },
});

function invalidVoiceResponse() {
  return new ConvexError({ code: "LIVE_VOICE_UNAVAILABLE", message: "Voice mode returned an invalid connection" });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function summarizeCall(transcript: string, apiKey: string | undefined) {
  const fallback = fallbackSummary(transcript);
  if (!apiKey) return fallback;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5-mini",
        input: [
          { role: "system", content: "Summarize this family voice call in 1-3 concise sentences. Preserve decisions, requests, and next steps. Do not mention that you are summarizing a transcript." },
          { role: "user", content: transcript },
        ],
      }),
    });
    if (!response.ok) return fallback;
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return fallback;
    const output = (payload as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }).output;
    return output?.flatMap(item => item.content ?? []).find(item => item.type === "output_text")?.text?.trim().slice(0, 2_000) || fallback;
  } catch {
    return fallback;
  }
}

function fallbackSummary(transcript: string) {
  const callerLines = transcript.split("\n").filter(line => line.startsWith("Caller: ")).map(line => line.slice(8).trim()).filter(Boolean);
  const focus = callerLines.join(" ").replace(/\s+/g, " ").slice(0, 420);
  return focus ? `Voice call about: ${focus}${focus.length === 420 ? "…" : ""}` : "Voice call completed with Saathi.";
}
