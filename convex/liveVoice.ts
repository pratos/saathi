import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, env, internalMutation, mutation } from "./_generated/server";
import { requireRoomPermission } from "./lib/authz";

const liveVoiceLimits = new RateLimiter(components.rateLimiter, {
  startLiveVoice: { kind: "fixed window", rate: 8, period: HOUR },
});

const historyItem = v.object({ role: v.union(v.literal("user"), v.literal("assistant")), text: v.string() });

export const startSession = action({
  args: { roomId: v.id("rooms"), sdp: v.string() },
  returns: v.object({ sessionId: v.string(), sdp: v.string() }),
  handler: async (ctx, { roomId, sdp }): Promise<{ sessionId: string; sdp: string }> => {
    if (!sdp.trim() || sdp.length > 100_000) throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid voice connection offer" });
    const prepared: { userId: Id<"users">; history: Array<{ role: "user" | "assistant"; text: string }> } =
      await ctx.runMutation(internal.liveVoice.prepare, { roomId });
    const apiKey = env.OPENAI_API_KEY?.trim();
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
          instructions: "You are Saathi, a warm, concise family assistant. Speak naturally in the language the caller uses. Help clarify and coordinate, but never claim to send messages, spend money, change accounts, or complete consequential actions. Ask for confirmation when a request would require action outside this conversation. Use web search when current information is needed.",
          input: prepared.history.map(item => ({
            type: "message",
            role: item.role,
            content: [{ type: item.role === "user" ? "input_text" : "output_text", text: item.text }],
          })),
          delegation: {
            type: "responses",
            responses: {
              model: "gpt-5-mini",
              instructions: "Use web search for current facts. Return concise, grounded results for a spoken family conversation.",
              tools: [{ type: "web_search" }],
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
  returns: v.object({ userId: v.id("users"), history: v.array(historyItem) }),
  handler: async (ctx, { roomId }) => {
    const { userId } = await requireRoomPermission(ctx, roomId, "post_message");
    const limit = await liveVoiceLimits.limit(ctx, "startLiveVoice", { key: String(userId) });
    if (!limit.ok) throw new ConvexError({ code: "RATE_LIMITED", retryAfter: limit.retryAfter });
    const messages = await ctx.db.query("messages").withIndex("by_room_created", q => q.eq("roomId", roomId)).order("desc").take(16);
    return {
      userId,
      history: messages.reverse().filter(message => message.actorType !== "email_guest").map(message => ({
        role: message.actorType === "assistant" || (message.actorType === "voice_transcript" && message.voiceSpeaker === "assistant")
          ? "assistant" as const
          : "user" as const,
        text: message.originalText.slice(0, 2_000),
      })),
    };
  },
});

export const saveTranscript = mutation({
  args: {
    roomId: v.id("rooms"),
    sessionId: v.string(),
    turns: v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      text: v.string(),
      startMs: v.number(),
    })),
  },
  returns: v.number(),
  handler: async (ctx, { roomId, sessionId, turns }) => {
    const { userId, room } = await requireRoomPermission(ctx, roomId, "post_message");
    if (!/^live_[A-Za-z0-9_-]{3,120}$/.test(sessionId)) throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid voice session" });
    if (turns.length > 100) throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Voice transcript is too long" });
    const session = await ctx.db.query("liveVoiceSessions").withIndex("by_session_id", q => q.eq("sessionId", sessionId)).unique();
    if (!session || session.roomId !== roomId || session.startedBy !== userId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "This voice session does not belong to you" });
    }
    if (session.finishedAt) return 0;
    let inserted = 0;
    for (const [index, turn] of turns.entries()) {
      const text = turn.text.trim();
      if (!text) continue;
      if (text.length > 20_000 || !Number.isFinite(turn.startMs) || turn.startMs < 0) {
        throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid voice transcript" });
      }
      const idempotencyKey = `live:${sessionId}:${Math.floor(turn.startMs)}:${index}`;
      const existing = await ctx.db.query("messages").withIndex("by_room_idempotency", q => q.eq("roomId", roomId).eq("idempotencyKey", idempotencyKey)).unique();
      if (existing) continue;
      await ctx.db.insert("messages", {
        spaceId: room.spaceId,
        roomId,
        authorUserId: userId,
        actorType: "voice_transcript",
        origin: "app",
        originalText: text,
        language: "en",
        idempotencyKey,
        voiceSpeaker: turn.role,
        createdAt: Date.now() + inserted,
      });
      inserted += 1;
    }
    await ctx.db.patch(session._id, { finishedAt: Date.now() });
    return inserted;
  },
});

function invalidVoiceResponse() {
  return new ConvexError({ code: "LIVE_VOICE_UNAVAILABLE", message: "Voice mode returned an invalid connection" });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
