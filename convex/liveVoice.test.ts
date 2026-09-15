import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("GPT-Live call summaries", () => {
  test("saves one authorized summary idempotently without scheduling the text agent", async () => {
    const t = convexTest(schema, modules);
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
      return { roomId, ownerId, outsiderId, oldAssistantId, oldUserId };
    });
    const owner = t.withIdentity({ subject: String(ownerId) });
    const outsider = t.withIdentity({ subject: String(outsiderId) });
    const args = {
      roomId,
      sessionId: "live_asymmetric_session_123",
      summary: "The family agreed that Saathi should reply in Marathi and confirm the travel time.",
    };

    await expect(outsider.mutation(internal.liveVoice.storeSummary, args)).rejects.toThrow(/does not belong/i);
    await expect(owner.mutation(internal.liveVoice.storeSummary, args)).resolves.toBe("saved");
    await expect(owner.mutation(internal.liveVoice.storeSummary, args)).resolves.toBe("already_saved");
    await expect(owner.action(api.liveVoice.finishSession, {
      roomId,
      sessionId: "live_empty_session_456",
      turns: [],
    })).resolves.toBe("saved");

    const messages = await owner.query(api.rooms.messages, { roomId });
    expect(messages.filter(message => message.actorType === "voice_transcript" && message.voiceSpeaker === undefined)
      .map(message => message.originalText).sort()).toEqual([
        "The family agreed that Saathi should reply in Marathi and confirm the travel time.",
        "Voice call completed with Saathi.",
      ]);
    expect(await t.run(ctx => ctx.db.get(oldUserId))).toMatchObject({ originalText: "Existing caller transcript", voiceSpeaker: "user" });
    expect(await t.run(ctx => ctx.db.get(oldAssistantId))).toMatchObject({ originalText: "Existing assistant transcript", voiceSpeaker: "assistant" });
    expect(await t.run(ctx => ctx.db.query("agentJobs").collect())).toEqual([]);
  });
});
