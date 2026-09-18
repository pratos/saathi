import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("durable voice browser sessions", () => {
  test("reauthorizes the voice call and rejects stale browser leases", async () => {
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const seeded = await t.run(async ctx => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const outsiderId = await ctx.db.insert("users", { email: "outsider@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "browser-family", createdAt: now });
      const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family", assistantMode: "mention", createdBy: ownerId, createdAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: outsiderId, role: "member", status: "active", joinedAt: now });
      await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt: now });
      await ctx.db.insert("roomMembers", { roomId, userId: outsiderId, role: "participant", createdAt: now });
      await ctx.db.insert("liveVoiceSessions", { sessionId: "live_browser_lease", spaceId, roomId, startedBy: ownerId, createdAt: now });
      return { ownerId, outsiderId, roomId };
    });
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    const outsider = t.withIdentity({ subject: String(seeded.outsiderId) });

    await expect(outsider.mutation(internal.liveVoice.prepareComputerTool, {
      roomId: seeded.roomId, sessionId: "live_browser_lease", callId: "call_outsider", task: "Open orders",
    })).rejects.toThrow(/does not belong/i);

    const profile = await owner.mutation(internal.liveVoice.prepareComputerTool, {
      roomId: seeded.roomId, sessionId: "live_browser_lease", callId: "call_first", task: "Open orders",
    });
    const first = await owner.mutation(internal.voiceBrowser.prepareSession, {
      roomId: seeded.roomId,
      voiceSessionId: "live_browser_lease",
      callId: "call_first",
      url: "https://shop.example.test/orders",
      task: "Open orders",
      profileName: profile.profileName,
    });
    await owner.mutation(internal.voiceBrowser.attachRemoteSession, {
      browserSessionId: first.browserSessionId, leaseId: first.leaseId, scrapeId: "scrape_first",
    });

    await owner.mutation(internal.liveVoice.prepareComputerTool, {
      roomId: seeded.roomId, sessionId: "live_browser_lease", callId: "call_second", task: "Open the first order",
    });
    const second = await owner.mutation(internal.voiceBrowser.prepareSession, {
      roomId: seeded.roomId,
      voiceSessionId: "live_browser_lease",
      callId: "call_second",
      url: "https://shop.example.test/orders",
      task: "Open the first order",
      profileName: profile.profileName,
    });
    expect(second.browserSessionId).toBe(first.browserSessionId);
    expect(second.attempt).toBe(2);
    expect(second.scrapeId).toBe("scrape_first");

    await owner.mutation(internal.voiceBrowser.recordDecision, {
      browserSessionId: first.browserSessionId,
      leaseId: first.leaseId,
      selectedActionId: "stale_action",
      selectedActionLabel: "Stale action",
      confidence: 1,
      outcome: "execute",
    });
    await owner.mutation(internal.voiceBrowser.recordDecision, {
      browserSessionId: second.browserSessionId,
      leaseId: second.leaseId,
      selectedActionId: "click_e2",
      selectedActionLabel: "Open first order",
      confidence: 0.94,
      outcome: "execute",
    });
    const row = await t.run(ctx => ctx.db.get(second.browserSessionId));
    expect(row).toMatchObject({
      attempt: 2,
      leaseId: second.leaseId,
      selectedActionId: "click_e2",
      selectedActionLabel: "Open first order",
      recentActions: [expect.objectContaining({ actionId: "click_e2" })],
    });
    expect(row?.recentActions.some(item => item.actionId === "stale_action")).toBe(false);
    await owner.mutation(internal.voiceBrowser.claimForVoiceEnd, {
      roomId: seeded.roomId, voiceSessionId: "live_browser_lease",
    });
    expect(await t.run(ctx => ctx.db.get(second.browserSessionId))).toMatchObject({
      phase: "stopping",
      terminalReason: "voice_call_ended",
      firecrawlCredits: 2,
    });
  });
});
