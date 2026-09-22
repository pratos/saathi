import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("family inbox processing", () => {
  test("extracts inbox values with DeepSeek Flash through OpenRouter", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-platform-key");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { model: string };
      expect(request.model).toBe("deepseek/deepseek-v4.1-flash");
      return new Response(JSON.stringify({
        model: request.model,
        choices: [{ message: { content: JSON.stringify({
          category: "subscriptions",
          subcategory: "subscription_renewal",
          amount: "$30.00",
          amountInr: null,
          amountUsd: "$30.00",
          dueAt: null,
          merchant: "Grok xAI",
          period: "September 2026",
          direction: "incoming",
          notes: null,
          actions: [],
        }) } }],
        usage: { prompt_tokens: 120, completion_tokens: 40 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const t = convexTest(schema, modules);
      const inboxItemId = await t.run(async ctx => {
        const createdAt = Date.now();
        const ownerId = await ctx.db.insert("users", { email: "owner@example.test", accessStatus: "approved" });
        const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "flash-extraction", createdAt });
        await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: createdAt });
        return ctx.db.insert("inboxItems", {
          spaceId,
          agentmailMessageId: "grok-receipt",
          agentmailThreadId: "grok-thread",
          sender: "billing@x.ai",
          subject: "Your receipt from Grok xAI",
          originalText: "Grok xAI subscription $30.00 for September 2026",
          visibility: "space",
          category: "needs_review",
          status: "processing",
          receivedAt: createdAt,
        });
      });

      await expect(t.action(internal.inboxWorkflow.extract, { inboxItemId })).resolves.toMatchObject({
        category: "subscriptions",
        subcategory: "subscription_renewal",
        amountUsd: "$30.00",
        merchant: "Grok xAI",
        model: "deepseek/deepseek-v4.1-flash",
        inputTokens: 120,
        outputTokens: 40,
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  test("tracks unread family inbox items independently for each member and family", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const createdAt = 1_800_000_000_000;
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const memberId = await ctx.db.insert("users", { email: "member@example.test" });
      const outsiderId = await ctx.db.insert("users", { email: "outsider@example.test" });
      const firstSpaceId = await ctx.db.insert("spaces", { name: "First family", createdBy: ownerId, creationKey: "unread-first", createdAt });
      const secondSpaceId = await ctx.db.insert("spaces", { name: "Second family", createdBy: outsiderId, creationKey: "unread-second", createdAt });
      await ctx.db.insert("memberships", { spaceId: firstSpaceId, userId: ownerId, role: "owner", status: "active", joinedAt: createdAt });
      await ctx.db.insert("memberships", { spaceId: firstSpaceId, userId: memberId, role: "member", status: "active", joinedAt: createdAt });
      await ctx.db.insert("memberships", { spaceId: secondSpaceId, userId: outsiderId, role: "owner", status: "active", joinedAt: createdAt });
      const olderId = await ctx.db.insert("inboxItems", {
        spaceId: firstSpaceId, agentmailMessageId: "message-older", agentmailThreadId: "thread-older",
        sender: "alerts@example.test", subject: "Older update", originalText: "Family update",
        visibility: "space", category: "home", status: "ready", receivedAt: createdAt + 1,
      });
      const newestId = await ctx.db.insert("inboxItems", {
        spaceId: firstSpaceId, agentmailMessageId: "message-newest", agentmailThreadId: "thread-newest",
        sender: "alerts@example.test", subject: "Newest update", originalText: "Family update",
        visibility: "space", category: "home", status: "ready", receivedAt: createdAt + 2,
      });
      const outsiderItemId = await ctx.db.insert("inboxItems", {
        spaceId: secondSpaceId, agentmailMessageId: "message-outsider", agentmailThreadId: "thread-outsider",
        sender: "alerts@example.test", subject: "Other family", originalText: "Private family update",
        visibility: "space", category: "home", status: "ready", receivedAt: createdAt + 3,
      });
      return { ownerId, memberId, firstSpaceId, olderId, newestId, outsiderItemId };
    });
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    const member = t.withIdentity({ subject: String(seeded.memberId) });

    await expect(owner.query(api.inbox.unreadCount, { spaceId: seeded.firstSpaceId })).resolves.toBe(2);
    await expect(member.query(api.inbox.unreadCount, { spaceId: seeded.firstSpaceId })).resolves.toBe(2);
    await owner.mutation(api.inbox.markSeen, { inboxItemId: seeded.newestId });
    await owner.mutation(api.inbox.markSeen, { inboxItemId: seeded.olderId });
    await expect(owner.query(api.inbox.unreadCount, { spaceId: seeded.firstSpaceId })).resolves.toBe(0);
    await expect(member.query(api.inbox.unreadCount, { spaceId: seeded.firstSpaceId })).resolves.toBe(2);
    await expect(owner.mutation(api.inbox.markSeen, { inboxItemId: seeded.outsiderItemId })).rejects.toThrow(/permission/i);

    await t.run(ctx => ctx.db.insert("inboxItems", {
      spaceId: seeded.firstSpaceId, agentmailMessageId: "message-latest", agentmailThreadId: "thread-latest",
      sender: "alerts@example.test", subject: "Latest update", originalText: "Another family update",
      visibility: "space", category: "home", status: "ready", receivedAt: 1_800_000_000_004,
    }));
    await expect(owner.query(api.inbox.unreadCount, { spaceId: seeded.firstSpaceId })).resolves.toBe(1);
    await expect(member.query(api.inbox.unreadCount, { spaceId: seeded.firstSpaceId })).resolves.toBe(3);
  });

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
      subcategory: "utility_bill",
      amount: "1200",
      amountInr: "1200",
      amountUsd: null,
      dueAt: 1_800_000_000_000,
      merchant: "BEST",
      period: "Sep 2026",
      direction: "incoming",
      notes: "PDF parsed",
      actions: [{ kind: "pay_bill", label: "Review electricity bill" }],
      model: "deepseek/deepseek-v4.1-flash",
      inputTokens: 240,
      outputTokens: 80,
      documentParseStatus: "parsed",
      documentParseRetryable: false,
      processingNotes: "Attached document read.",
    });
    const item = await t.run(ctx => ctx.db.get(seeded.inboxItemId));
    expect(item).toMatchObject({
      category: "bills", subcategory: "utility_bill", status: "ready", direction: "incoming", documentParseStatus: "parsed",
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
