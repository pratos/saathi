import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("GPT-Live transcripts", () => {
  test("saves authorized user and assistant turns once without scheduling the text agent", async () => {
    const t = convexTest(schema, modules);
    const { roomId, ownerId, outsiderId } = await t.run(async ctx => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const outsiderId = await ctx.db.insert("users", { email: "outsider@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "family-create-001", createdAt: now });
      const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family", assistantMode: "automatic", createdBy: ownerId, createdAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
      await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt: now });
      await ctx.db.insert("liveVoiceSessions", { sessionId: "live_asymmetric_session_123", spaceId, roomId, startedBy: ownerId, createdAt: now });
      return { roomId, ownerId, outsiderId };
    });
    const owner = t.withIdentity({ subject: String(ownerId) });
    const outsider = t.withIdentity({ subject: String(outsiderId) });
    const args = {
      roomId,
      sessionId: "live_asymmetric_session_123",
      turns: [
        { role: "user" as const, text: "मराठीत सांगा", startMs: 125 },
        { role: "assistant" as const, text: "नक्की. मी मराठीत उत्तर देईन.", startMs: 980 },
      ],
    };

    await expect(outsider.mutation(api.liveVoice.saveTranscript, args)).rejects.toThrow(/permission/i);
    await expect(owner.mutation(api.liveVoice.saveTranscript, args)).resolves.toBe(2);
    await expect(owner.mutation(api.liveVoice.saveTranscript, args)).resolves.toBe(0);

    const messages = await owner.query(api.rooms.messages, { roomId });
    expect(messages.map(message => ({ actorType: message.actorType, text: message.originalText }))).toEqual([
      { actorType: "voice_transcript", text: "नक्की. मी मराठीत उत्तर देईन." },
      { actorType: "voice_transcript", text: "मराठीत सांगा" },
    ]);
    expect(await t.run(ctx => ctx.db.query("agentJobs").collect())).toEqual([]);
  });
});
