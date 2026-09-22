import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const extraction = {
  category: "bills" as const,
  subcategory: "utility_bill" as const,
  amount: "₹1,200",
  amountInr: "₹1,200",
  amountUsd: null,
  dueAt: 1_800_000_000_000,
  merchant: "BEST",
  period: "September 2026",
  direction: "incoming" as const,
};

describe("inbox recategorization", () => {
  test("only an owner can start or inspect a selected family job", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const now = 1_800_000_000_000;
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const memberId = await ctx.db.insert("users", { email: "member@example.test" });
      const outsiderId = await ctx.db.insert("users", { email: "outsider@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "recategorization-owner", createdAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: memberId, role: "member", status: "active", joinedAt: now });
      return { ownerId, memberId, outsiderId, spaceId };
    });
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    const member = t.withIdentity({ subject: String(seeded.memberId) });
    const outsider = t.withIdentity({ subject: String(seeded.outsiderId) });

    await expect(t.mutation(api.recategorization.startForSpace, { spaceId: seeded.spaceId })).rejects.toThrow(/sign in/i);
    await expect(member.mutation(api.recategorization.startForSpace, { spaceId: seeded.spaceId })).rejects.toThrow(/permission/i);
    const jobId = await owner.mutation(api.recategorization.startForSpace, { spaceId: seeded.spaceId });
    await expect(owner.mutation(api.recategorization.startForSpace, { spaceId: seeded.spaceId })).resolves.toBe(jobId);
    await expect(outsider.query(api.recategorization.status, { jobId })).rejects.toThrow(/permission/i);
    await expect(member.query(api.recategorization.status, { jobId })).rejects.toThrow(/permission/i);
    await expect(owner.query(api.recategorization.status, { jobId })).resolves.toMatchObject({
      spaceId: seeded.spaceId,
      status: "queued",
      discovered: 0,
      total: null,
    });
  });

  test("scans only the selected tenant in resumable batches and counts an item once", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const now = 1_800_000_000_000;
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const outsiderId = await ctx.db.insert("users", { email: "outsider@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "recategorization-batches", createdAt: now });
      const otherSpaceId = await ctx.db.insert("spaces", { name: "Other", createdBy: outsiderId, creationKey: "recategorization-other", createdAt: now });
      const inboxItemIds = await Promise.all([...Array(6)].map((_, index) => ctx.db.insert("inboxItems", {
        spaceId,
        agentmailMessageId: `family-${index}`,
        agentmailThreadId: `family-thread-${index}`,
        sender: "billing@example.test",
        subject: `Family bill ${index}`,
        originalText: "Electricity bill",
        visibility: "space",
        category: "needs_review",
        status: "ready",
        receivedAt: now + index,
      })));
      await ctx.db.insert("inboxItems", {
        spaceId: otherSpaceId,
        agentmailMessageId: "other-family",
        agentmailThreadId: "other-thread",
        sender: "billing@example.test",
        subject: "Other family bill",
        originalText: "Private bill",
        visibility: "space",
        category: "needs_review",
        status: "ready",
        receivedAt: now,
      });
      const jobId = await ctx.db.insert("inboxRecategorizationJobs", {
        spaceId,
        createdBy: ownerId,
        startedAt: now,
        updatedAt: now,
        status: "running",
        discovered: 0,
        recategorized: 0,
        skipped: 0,
        scanComplete: false,
      });
      return { jobId, inboxItemIds };
    });

    const first = await t.mutation(internal.recategorization.claimNextBatch, { jobId: seeded.jobId });
    expect(first).toMatchObject({ complete: false });
    expect(first.inboxItemIds).toHaveLength(5);
    expect(first.inboxItemIds.every(id => seeded.inboxItemIds.includes(id))).toBe(true);

    const firstItemId = first.inboxItemIds[0];
    await expect(t.mutation(internal.recategorization.applyExtraction, {
      jobId: seeded.jobId, inboxItemId: firstItemId, ...extraction,
    })).resolves.toBe("recategorized");
    await t.mutation(internal.recategorization.recordOutcome, {
      jobId: seeded.jobId, inboxItemId: firstItemId, outcome: "recategorized",
    });
    await t.mutation(internal.recategorization.recordOutcome, {
      jobId: seeded.jobId, inboxItemId: firstItemId, outcome: "recategorized",
    });

    const resumed = await t.mutation(internal.recategorization.claimNextBatch, { jobId: seeded.jobId });
    expect(resumed.inboxItemIds).toHaveLength(4);
    expect(resumed.inboxItemIds).not.toContain(firstItemId);
    for (const inboxItemId of resumed.inboxItemIds) {
      await t.mutation(internal.recategorization.applyExtraction, { jobId: seeded.jobId, inboxItemId, ...extraction });
      await t.mutation(internal.recategorization.recordOutcome, { jobId: seeded.jobId, inboxItemId, outcome: "recategorized" });
    }
    await t.mutation(internal.recategorization.finishCurrentBatch, { jobId: seeded.jobId });

    const second = await t.mutation(internal.recategorization.claimNextBatch, { jobId: seeded.jobId });
    expect(second.inboxItemIds).toEqual([seeded.inboxItemIds[5]]);
    await t.mutation(internal.recategorization.applyExtraction, { jobId: seeded.jobId, inboxItemId: second.inboxItemIds[0], ...extraction });
    await t.mutation(internal.recategorization.recordOutcome, { jobId: seeded.jobId, inboxItemId: second.inboxItemIds[0], outcome: "recategorized" });
    await t.mutation(internal.recategorization.finishCurrentBatch, { jobId: seeded.jobId });

    const complete = await t.mutation(internal.recategorization.claimNextBatch, { jobId: seeded.jobId });
    expect(complete).toEqual({ inboxItemIds: [], complete: true });
    const job = await t.run(ctx => ctx.db.get(seeded.jobId));
    expect(job).toMatchObject({ status: "complete", discovered: 6, recategorized: 6, skipped: 0, scanComplete: true });
  });

  test("skips reviewed items and preserves human actions, heartbeats, and status", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const startedAt = 1_800_000_000_000;
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "recategorization-reviewed", createdAt: startedAt });
      const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family", assistantMode: "mention", createdBy: ownerId, createdAt: startedAt });
      const heartbeatMessageId = await ctx.db.insert("messages", {
        spaceId, roomId, actorType: "assistant", origin: "assistant", originalText: "Existing heartbeat", language: "en",
        idempotencyKey: "existing-heartbeat", createdAt: startedAt,
      });
      const reviewedId = await ctx.db.insert("inboxItems", {
        spaceId, roomId, agentmailMessageId: "reviewed", agentmailThreadId: "reviewed-thread",
        sender: "bills@example.test", subject: "Reviewed bill", originalText: "Old bill", visibility: "space",
        category: "school", subcategory: "school_fee", status: "ready", extractedMerchant: "Manual school", actionStatus: "confirmed",
        suggestedActions: [{ kind: "pay", label: "Pay manually" }], heartbeatMessageId, reviewedAt: startedAt + 1, receivedAt: startedAt,
      });
      const unreviewedId = await ctx.db.insert("inboxItems", {
        spaceId, roomId, agentmailMessageId: "unreviewed", agentmailThreadId: "unreviewed-thread",
        sender: "bills@example.test", subject: "Unreviewed bill", originalText: "New bill", visibility: "space",
        category: "needs_review", status: "ready", suggestedActions: [{ kind: "review", label: "Keep this suggestion" }],
        heartbeatMessageId, receivedAt: startedAt + 2,
      });
      const jobId = await ctx.db.insert("inboxRecategorizationJobs", {
        spaceId, createdBy: ownerId, startedAt, updatedAt: startedAt, status: "running", currentBatch: [reviewedId, unreviewedId],
        currentBatchCompleted: [], currentBatchIsFinal: true, discovered: 2, recategorized: 0, skipped: 0, scanComplete: false,
      });
      return { jobId, reviewedId, unreviewedId, heartbeatMessageId, roomId };
    });

    await expect(t.mutation(internal.recategorization.checkEligibility, {
      jobId: seeded.jobId, inboxItemId: seeded.reviewedId,
    })).resolves.toBe(false);
    await expect(t.mutation(internal.recategorization.checkEligibility, {
      jobId: seeded.jobId, inboxItemId: seeded.unreviewedId,
    })).resolves.toBe(true);
    await expect(t.mutation(internal.recategorization.applyExtraction, {
      jobId: seeded.jobId, inboxItemId: seeded.reviewedId, ...extraction,
    })).resolves.toBe("skipped");
    await expect(t.mutation(internal.recategorization.applyExtraction, {
      jobId: seeded.jobId, inboxItemId: seeded.unreviewedId, ...extraction,
    })).resolves.toBe("recategorized");

    const [reviewed, unreviewed, messages] = await t.run(async ctx => [
      await ctx.db.get(seeded.reviewedId),
      await ctx.db.get(seeded.unreviewedId),
      await ctx.db.query("messages").withIndex("by_room_created", q => q.eq("roomId", seeded.roomId)).take(10),
    ]);
    expect(reviewed).toMatchObject({
      category: "school", subcategory: "school_fee", extractedMerchant: "Manual school", actionStatus: "confirmed",
      suggestedActions: [{ kind: "pay", label: "Pay manually" }], heartbeatMessageId: seeded.heartbeatMessageId, status: "ready",
    });
    expect(unreviewed).toMatchObject({
      category: "bills", subcategory: "utility_bill", suggestedActions: [{ kind: "review", label: "Keep this suggestion" }],
      heartbeatMessageId: seeded.heartbeatMessageId, status: "ready",
    });
    expect(messages).toHaveLength(1);
  });
});
