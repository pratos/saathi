import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("family inbox processing", () => {
  test("owners can confirm a suggested action once and members cannot read another family's item", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const createdAt = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const memberId = await ctx.db.insert("users", { email: "member@example.test" });
      const outsiderId = await ctx.db.insert("users", { email: "outsider@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "family-inbox-1", createdAt });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: createdAt });
      await ctx.db.insert("memberships", { spaceId, userId: memberId, role: "member", status: "active", joinedAt: createdAt });
      const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family conversation", assistantMode: "mention", createdBy: ownerId, createdAt });
      await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt });
      await ctx.db.insert("roomMembers", { roomId, userId: memberId, role: "participant", createdAt });
      const inboxItemId = await ctx.db.insert("inboxItems", {
        spaceId, roomId, agentmailMessageId: "msg-magzter", agentmailThreadId: "thread-magzter",
        sender: "billing@magzter.test", subject: "Magzter renewal", originalText: "Unsubscribe at https://magzter.example/unsub",
        visibility: "space", category: "subscriptions", status: "ready", extractedAmount: "499",
        direction: "incoming", suggestedActions: [{ kind: "unsubscribe", label: "Unsubscribe Magzter", url: "https://magzter.example/unsub" }],
        actionStatus: "suggested", receivedAt: createdAt,
      });
      return { ownerId, memberId, outsiderId, spaceId, inboxItemId };
    });
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    const outsider = t.withIdentity({ subject: String(seeded.outsiderId) });

    await expect(outsider.mutation(api.inbox.confirmAction, { inboxItemId: seeded.inboxItemId })).rejects.toThrow(/permission/i);
    await owner.mutation(api.inbox.confirmAction, { inboxItemId: seeded.inboxItemId });
    await owner.mutation(api.inbox.confirmAction, { inboxItemId: seeded.inboxItemId });

    const item = await t.run(ctx => ctx.db.get(seeded.inboxItemId));
    expect(item?.actionStatus).toBe("confirmed");
    const messages = await t.run(async ctx => ctx.db.query("messages").collect());
    expect(messages.filter(message => message.idempotencyKey === `inbox-action:${seeded.inboxItemId}`)).toHaveLength(1);
  });

  test("space members without a room grant cannot write a confirmation into the family chat", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const createdAt = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const memberId = await ctx.db.insert("users", { email: "member@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "family-inbox-room", createdAt });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: createdAt });
      await ctx.db.insert("memberships", { spaceId, userId: memberId, role: "member", status: "active", joinedAt: createdAt });
      const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family conversation", assistantMode: "mention", createdBy: ownerId, createdAt });
      await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt });
      const inboxItemId = await ctx.db.insert("inboxItems", {
        spaceId, roomId, agentmailMessageId: "msg-room-grant", agentmailThreadId: "thread-room-grant",
        sender: "billing@example.test", subject: "Invoice", originalText: "Pay later",
        visibility: "space", category: "bills", status: "ready",
        suggestedActions: [{ kind: "pay", label: "Review payment" }],
        actionStatus: "suggested", receivedAt: createdAt,
      });
      return { memberId, inboxItemId, roomId };
    });
    const member = t.withIdentity({ subject: String(seeded.memberId) });
    await member.mutation(api.inbox.confirmAction, { inboxItemId: seeded.inboxItemId });
    const item = await t.run(ctx => ctx.db.get(seeded.inboxItemId));
    expect(item?.actionStatus).toBe("confirmed");
    const messages = await t.run(async ctx => ctx.db.query("messages").collect());
    expect(messages.filter(message => message.roomId === seeded.roomId)).toEqual([]);
  });

  test("extraction persistence stores direction, PDF status, heartbeat, and usage once", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const createdAt = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "family-inbox-2", createdAt, modelTier: "med" });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: createdAt });
      const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family conversation", assistantMode: "mention", createdBy: ownerId, createdAt });
      await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt });
      const inboxItemId = await ctx.db.insert("inboxItems", {
        spaceId, roomId, agentmailMessageId: "msg-bill", agentmailThreadId: "thread-bill",
        sender: "bills@example.test", subject: "Electricity bill", originalText: "Amount due 1200",
        visibility: "space", category: "needs_review", status: "processing", receivedAt: createdAt,
      });
      return { ownerId, spaceId, inboxItemId };
    });
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    await owner.mutation(internal.inboxWorkflow.applyExtraction, {
      inboxItemId: seeded.inboxItemId,
      category: "bills",
      amount: "1200",
      amountInr: "1200",
      amountUsd: null,
      dueAt: 1_800_000_000_000,
      merchant: "BEST",
      period: "Sep 2026",
      direction: "incoming",
      notes: "PDF parsed",
      actions: [{ kind: "pay_bill", label: "Review electricity bill" }],
      documentParseStatus: "parsed",
      documentParseRetryable: false,
      processingNotes: "Attached document read.",
    });
    const item = await t.run(ctx => ctx.db.get(seeded.inboxItemId));
    expect(item).toMatchObject({
      category: "bills", status: "ready", direction: "incoming", documentParseStatus: "parsed",
      documentParseRetryable: false, extractedMerchant: "BEST",
    });
    expect(item?.heartbeatMessageId).toBeTruthy();
    await owner.mutation(api.inbox.reprocess, { inboxItemId: seeded.inboxItemId });
    const reprocessed = await t.run(ctx => ctx.db.get(seeded.inboxItemId));
    expect(reprocessed).toMatchObject({ status: "processing" });
    expect(reprocessed?.documentParseStatus).toBeUndefined();
    expect(reprocessed?.documentParseRetryable).toBeUndefined();
    expect(reprocessed?.processingNotes).toBeUndefined();
    await expect(owner.mutation(api.inbox.reprocess, { inboxItemId: seeded.inboxItemId })).resolves.toBe(seeded.inboxItemId);
    const usage = await owner.query(api.spaces.usageBreakdown, { spaceId: seeded.spaceId });
    expect(usage.tier).toBe("med");
    expect(usage.rows.some(row => row.costClass === "email_extraction")).toBe(true);
    expect(usage.entries.some(row => row.costClass === "email_extraction")).toBe(true);
  });
});
