import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("GPT-Live call summaries", () => {
  test("saves one authorized summary idempotently without scheduling the text agent", async () => {
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const { roomId, ownerId, outsiderId, oldAssistantId, oldUserId } = await t.run(async ctx => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const outsiderId = await ctx.db.insert("users", { email: "outsider@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "family-create-001", createdAt: now });
      const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family", assistantMode: "automatic", createdBy: ownerId, createdAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: outsiderId, role: "member", status: "active", joinedAt: now });
      await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt: now });
      await ctx.db.insert("roomMembers", { roomId, userId: outsiderId, role: "participant", createdAt: now });
      await ctx.db.insert("agents", {
        spaceId, roomId, createdBy: ownerId, creationKey: "voice-memory-agent", name: "Saathi",
        systemPrompt: "Be helpful", provider: "openrouter", model: "openai/gpt-5.6-luna", status: "idle",
        createdAt: now, updatedAt: now,
      });
      const oldUserId = await ctx.db.insert("messages", {
        spaceId, roomId, authorUserId: ownerId, actorType: "voice_transcript", voiceSpeaker: "user", origin: "app",
        originalText: "Existing caller transcript", language: "en", idempotencyKey: "old-live-user", createdAt: now - 2,
      });
      const oldAssistantId = await ctx.db.insert("messages", {
        spaceId, roomId, actorType: "voice_transcript", voiceSpeaker: "assistant", origin: "assistant",
        originalText: "Existing assistant transcript", language: "en", idempotencyKey: "old-live-assistant", createdAt: now - 1,
      });
      await ctx.db.insert("liveVoiceSessions", { sessionId: "live_asymmetric_session_123", spaceId, roomId, startedBy: ownerId, createdAt: now });
      await ctx.db.insert("liveVoiceSessions", { sessionId: "live_empty_session_456", spaceId, roomId, startedBy: ownerId, createdAt: now + 1 });
      await ctx.db.insert("liveVoiceSessions", { sessionId: "live_browser_session_789", spaceId, roomId, startedBy: ownerId, createdAt: now + 2 });
      return { roomId, ownerId, outsiderId, oldAssistantId, oldUserId };
    });
    const owner = t.withIdentity({ subject: String(ownerId) });
    const outsider = t.withIdentity({ subject: String(outsiderId) });
    const args = {
      roomId,
      sessionId: "live_asymmetric_session_123",
      summary: "The family agreed that Saathi should reply in Marathi and confirm the travel time.",
    };

    await owner.mutation(internal.liveVoice.prepareComputerTool, {
      roomId,
      sessionId: "live_browser_session_789",
      callId: "call_browser_handoff",
      task: "Open the school parent login page",
    });
    await owner.mutation(internal.liveVoice.updateComputerView, {
      roomId,
      sessionId: "live_browser_session_789",
      callId: "call_browser_handoff",
      liveViewUrl: "https://example.test/view-only",
      interactiveLiveViewUrl: "https://example.test/interactive",
    });
    await owner.mutation(internal.liveVoice.updateComputerView, {
      roomId,
      sessionId: "live_browser_session_789",
      callId: "stale-call",
      interactiveLiveViewUrl: "https://attacker.example.test/stale",
    });
    await expect(owner.query(api.liveVoice.computerToolState, {
      roomId,
      sessionId: "live_browser_session_789",
    })).resolves.toEqual({
      callId: "call_browser_handoff",
      task: "Open the school parent login page",
      liveViewUrl: "https://example.test/view-only",
      interactiveLiveViewUrl: "https://example.test/interactive",
    });
    await expect(outsider.query(api.liveVoice.computerToolState, {
      roomId,
      sessionId: "live_browser_session_789",
    })).resolves.toBeNull();
    await owner.mutation(internal.liveVoice.finishComputerTool, {
      roomId,
      sessionId: "live_browser_session_789",
      callId: "call_browser_handoff",
    });
    await expect(owner.query(api.liveVoice.computerToolState, {
      roomId,
      sessionId: "live_browser_session_789",
    })).resolves.toBeNull();

    const voiceLog = {
      roomId,
      sessionId: "live_asymmetric_session_123",
      callId: "call_voice_search_123",
      toolName: "search_public_web",
      detail: "Pune weather tomorrow",
      ok: true,
      resultPreview: "Sunny with a chance of rain.",
      latencyMs: 142,
    };
    await expect(outsider.mutation(api.liveVoice.logToolResult, voiceLog)).rejects.toThrow(/does not belong/i);
    await expect(owner.mutation(api.liveVoice.logToolResult, voiceLog)).resolves.toBeNull();
    expect(await t.run(ctx => ctx.db.query("jevDecisions").collect())).toEqual([
      expect.objectContaining({
        source: "voice_tool",
        decision: "search_public_web",
        inputPreview: "Search public web — Pune weather tomorrow",
        latencyMs: 142,
        inputTokens: 0,
        details: expect.objectContaining({ ok: true, jevGateApplied: false }),
      }),
    ]);

    await expect(outsider.mutation(internal.liveVoice.storeSummary, args)).rejects.toThrow(/does not belong/i);
    await expect(owner.mutation(internal.liveVoice.storeSummary, args)).resolves.toBe("saved");
    await expect(owner.mutation(internal.liveVoice.storeSummary, args)).resolves.toBe("already_saved");
    await expect(owner.action(api.liveVoice.finishSession, {
      roomId,
      sessionId: "live_empty_session_456",
      turns: [],
      voiceSeconds: 18,
      voiceUsageFinalized: true,
    })).resolves.toBe("saved");

    const messages = await owner.query(api.rooms.messages, { roomId });
    expect(messages.filter(message => message.actorType === "voice_transcript" && message.voiceSpeaker === undefined)
      .map(message => message.originalText).sort()).toEqual([
        "The family agreed that Saathi should reply in Marathi and confirm the travel time.",
        "Voice call completed with Saathi.",
      ]);
    expect(messages.find(message => message.idempotencyKey === "live-summary:live_empty_session_456")).toMatchObject({
      voiceSeconds: 18,
      voiceCostUsd: 0.015,
      voiceUsageFinalized: true,
    });
    expect(await t.run(ctx => ctx.db.query("usageLedger").collect())).toEqual([
      expect.objectContaining({ provider: "openai", model: "gpt-live-1", unit: "second", quantity: 18, costUsd: 0.015, costClass: "voice" }),
    ]);
    expect(await t.run(ctx => ctx.db.get(oldUserId))).toMatchObject({ originalText: "Existing caller transcript", voiceSpeaker: "user" });
    expect(await t.run(ctx => ctx.db.get(oldAssistantId))).toMatchObject({ originalText: "Existing assistant transcript", voiceSpeaker: "assistant" });
    expect(await t.run(ctx => ctx.db.query("agentJobs").collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("agentEpisodes").collect())).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "voice", sourceKey: "voice:live_asymmetric_session_123", summary: expect.stringContaining("reply in Marathi") }),
      expect.objectContaining({ source: "voice", sourceKey: "voice:live_empty_session_456", summary: expect.stringContaining("Voice call completed") }),
    ]));

    await owner.mutation(api.conversationActions.execute, {
      roomId,
      action: { type: "remember", key: "school pickup", value: "Friday at 3 PM" },
    });
    const prepared = await owner.mutation(internal.liveVoice.prepare, { roomId });
    expect(prepared.history[0]?.text).toContain("school pickup: Friday at 3 PM");
    expect(prepared.history[0]?.text).toContain("reply in Marathi");
  });
});
