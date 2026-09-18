import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("shared inbox classification telemetry", () => {
  test("records one bounded authorized decision across retries and exposes downstream disposition", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const memberId = await ctx.db.insert("users", { email: "member@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "inbox-telemetry", createdAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: memberId, role: "member", status: "active", joinedAt: now });
      const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family", assistantMode: "mention", createdBy: ownerId, createdAt: now });
      const inboxItemId = await ctx.db.insert("inboxItems", {
        spaceId, roomId, agentmailMessageId: "agentmail-message-1", agentmailThreadId: "agentmail-thread-1",
        sender: "private-sender@example.test", subject: "Secret account subject", originalText: "Sensitive body",
        visibility: "space", category: "bills", status: "ready", receivedAt: now,
      });
      const gmailItemId = await ctx.db.insert("inboxItems", {
        spaceId, roomId, agentmailMessageId: "gmail:account:message-1", agentmailThreadId: "gmail:account:thread-1",
        sender: "bank@example.test", subject: "Already classified", originalText: "Existing Gmail path",
        visibility: "space", category: "bank", status: "ready", receivedAt: now + 1,
      });
      return { ownerId, memberId, spaceId, inboxItemId, gmailItemId };
    });

    await expect(t.mutation(internal.jev.claimInboxClassification, { inboxItemId: seeded.inboxItemId })).resolves.toBe(true);
    await expect(t.mutation(internal.jev.claimInboxClassification, { inboxItemId: seeded.inboxItemId })).resolves.toBe(false);
    await expect(t.mutation(internal.jev.claimInboxClassification, { inboxItemId: seeded.gmailItemId })).resolves.toBe(false);

    const result = {
      kind: "classified" as const,
      decision: {
        category: "bills" as const,
        confidence: 0.93,
        probabilities: { bills: 0.93, receipts: 0.03, bank: 0.02, ignore: 0.02 },
        tracksHouseholdMoney: 0.96,
        containsOtpOrLoginCode: 0.01,
        model: "jev-latest",
        inputTokens: 41,
        latencyMs: 24,
      },
      disposition: "retained_household_candidate" as const,
    };
    await t.mutation(internal.jev.completeInboxClassification, { inboxItemId: seeded.inboxItemId, result });
    await t.mutation(internal.jev.completeInboxClassification, {
      inboxItemId: seeded.inboxItemId,
      result: { ...result, decision: { ...result.decision, category: "ignore", confidence: 0.99 } },
    });

    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    const member = t.withIdentity({ subject: String(seeded.memberId) });
    const rows = await owner.query(api.jev.recent, { spaceId: seeded.spaceId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      inboxItemId: seeded.inboxItemId,
      source: "gmail",
      artifactSource: "agentmail",
      decision: "bills",
      confidence: 0.93,
      model: "jev-latest",
      latencyMs: 24,
      inputTokens: 41,
      disposition: "retained_household_candidate",
      classificationState: "complete",
      details: { downstreamCategory: "bills", downstreamStatus: "ready" },
    });
    expect(rows[0].inputPreview).toBe("Shared household inbox email");
    expect(JSON.stringify(rows[0])).not.toContain("Secret account subject");
    expect(JSON.stringify(rows[0])).not.toContain("Sensitive body");
    await expect(member.query(api.jev.recent, { spaceId: seeded.spaceId })).rejects.toThrow(/permission/i);
  });

  test("makes unavailable telemetry observable without exposing provider errors", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "inbox-failure", createdAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
      const inboxItemId = await ctx.db.insert("inboxItems", {
        spaceId, agentmailMessageId: "agentmail-message-2", agentmailThreadId: "agentmail-thread-2",
        sender: "sender@example.test", subject: "न भरलेले बिल", originalText: "मराठी मजकूर",
        visibility: "space", category: "needs_review", status: "ready", receivedAt: now,
      });
      return { ownerId, spaceId, inboxItemId };
    });
    await t.mutation(internal.jev.claimInboxClassification, { inboxItemId: seeded.inboxItemId });
    await t.mutation(internal.jev.completeInboxClassification, {
      inboxItemId: seeded.inboxItemId,
      result: {
        kind: "unavailable", reason: "classification_failed", model: "jev-email",
        inputTokens: 0, latencyMs: 11, disposition: "retained_classification_unavailable",
      },
    });

    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    await expect(owner.query(api.jev.recent, { spaceId: seeded.spaceId })).resolves.toEqual([
      expect.objectContaining({
        decision: "unavailable",
        disposition: "retained_classification_unavailable",
        details: { reason: "classification_failed", downstreamCategory: "needs_review", downstreamStatus: "ready" },
      }),
    ]);
  });
});
