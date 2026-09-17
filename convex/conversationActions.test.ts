import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import { MODEL_TIERS } from "./lib/modelTiers.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("conversational actions", () => {
  test("applies personal settings but keeps family settings owner-only", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const memberId = await ctx.db.insert("users", { email: "member@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "conversation-family", createdAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: memberId, role: "member", status: "active", joinedAt: now });
      const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family conversation", assistantMode: "mention", createdBy: ownerId, createdAt: now });
      await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt: now });
      await ctx.db.insert("roomMembers", { roomId, userId: memberId, role: "participant", createdAt: now });
      await ctx.db.insert("agents", {
        spaceId, roomId, createdBy: ownerId, creationKey: "saathi-default", name: "Saathi",
        systemPrompt: "Be helpful", provider: "openrouter", model: MODEL_TIERS.med.model, status: "idle",
        createdAt: now, updatedAt: now,
      });
      return { ownerId, memberId, roomId, spaceId };
    });
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    const member = t.withIdentity({ subject: String(seeded.memberId) });

    await expect(member.mutation(api.conversationActions.execute, {
      roomId: seeded.roomId,
      action: { type: "set_language", language: "mr" },
    })).resolves.toEqual({ ok: true, message: "Your reading language is now Marathi." });
    await expect(member.mutation(api.conversationActions.execute, {
      roomId: seeded.roomId,
      action: { type: "set_food_budget", amount: 15_000, currency: "INR" },
    })).resolves.toEqual({ ok: false, message: "Only a family owner can change family-wide settings." });
    await expect(owner.mutation(api.conversationActions.execute, {
      roomId: seeded.roomId,
      action: { type: "set_food_budget", amount: 15_000, currency: "INR" },
    })).resolves.toEqual({ ok: true, message: "The family food budget is now ₹15,000 per month." });
    await expect(member.mutation(api.conversationActions.execute, {
      roomId: seeded.roomId,
      action: { type: "get_food_budget" },
    })).resolves.toEqual({ ok: true, message: "Food budget: ₹0 spent of ₹15,000; ₹15,000 remaining." });
    await owner.mutation(api.conversationActions.execute, {
      roomId: seeded.roomId,
      action: { type: "set_model_tier", tier: "high" },
    });

    expect(await t.run(ctx => ctx.db.get(seeded.memberId))).toMatchObject({ preferredLanguage: "mr" });
    expect(await t.run(ctx => ctx.db.query("familyBudgets").unique())).toMatchObject({ monthlyLimit: 15_000, currency: "INR" });
    expect(await t.run(ctx => ctx.db.get(seeded.spaceId))).toMatchObject({ modelTier: "high" });
    expect(await t.run(ctx => ctx.db.query("agents").unique())).toMatchObject({ model: MODEL_TIERS.high.model });
  });

  test("rejects a budget outside the real API limits without writing it", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "budget-boundary", createdAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
      const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family", assistantMode: "mention", createdBy: ownerId, createdAt: now });
      await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt: now });
      return { ownerId, roomId };
    });
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    await expect(owner.mutation(api.conversationActions.execute, {
      roomId: seeded.roomId,
      action: { type: "set_food_budget", amount: 499, currency: "INR" },
    })).resolves.toMatchObject({ ok: false });
    expect(await t.run(ctx => ctx.db.query("familyBudgets").collect())).toEqual([]);
  });

  test("stores normalized facts for one room agent and never leaks them to another room", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "memory-family", createdAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
      const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family", assistantMode: "mention", createdBy: ownerId, createdAt: now });
      const otherRoomId = await ctx.db.insert("rooms", { spaceId, type: "private", title: "Private", assistantMode: "mention", createdBy: ownerId, createdAt: now });
      await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt: now });
      await ctx.db.insert("roomMembers", { roomId: otherRoomId, userId: ownerId, role: "manager", createdAt: now });
      for (const [targetRoomId, creationKey] of [[roomId, "family-agent"], [otherRoomId, "private-agent"]] as const) {
        await ctx.db.insert("agents", {
          spaceId, roomId: targetRoomId, createdBy: ownerId, creationKey, name: "Saathi",
          systemPrompt: "Be helpful", provider: "openrouter", model: MODEL_TIERS.med.model, status: "idle",
          createdAt: now, updatedAt: now,
        });
      }
      return { ownerId, roomId, otherRoomId };
    });
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });

    await expect(owner.mutation(api.conversationActions.execute, {
      roomId: seeded.roomId,
      action: { type: "remember", key: "  Departure   City ", value: "Pune" },
    })).resolves.toEqual({ ok: true, message: "I'll remember departure city: Pune" });
    await expect(owner.mutation(api.conversationActions.execute, {
      roomId: seeded.roomId,
      action: { type: "recall", key: "DEPARTURE CITY" },
    })).resolves.toEqual({ ok: true, message: "departure city: Pune" });
    await expect(owner.mutation(api.conversationActions.execute, {
      roomId: seeded.roomId,
      action: { type: "list_memories" },
    })).resolves.toEqual({ ok: true, message: "departure city: Pune" });
    await expect(owner.mutation(api.conversationActions.execute, {
      roomId: seeded.otherRoomId,
      action: { type: "recall", key: "departure city" },
    })).resolves.toEqual({ ok: false, message: "I don't have a saved fact for “departure city”." });
    await expect(owner.mutation(api.conversationActions.execute, {
      roomId: seeded.roomId,
      action: { type: "forget_memory", key: "departure city" },
    })).resolves.toEqual({ ok: true, message: "I forgot the saved fact “departure city”." });
    await expect(owner.mutation(api.conversationActions.execute, {
      roomId: seeded.roomId,
      action: { type: "recall", key: "departure city" },
    })).resolves.toMatchObject({ ok: false });
  });

  test("searches only files and saved inbox items visible in the current room", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "search-family", createdAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
      const roomId = await ctx.db.insert("rooms", { spaceId, type: "private", title: "Mine", assistantMode: "mention", personalOwnerId: ownerId, createdBy: ownerId, createdAt: now });
      const otherRoomId = await ctx.db.insert("rooms", { spaceId, type: "private", title: "Other", assistantMode: "mention", personalOwnerId: ownerId, createdBy: ownerId, createdAt: now + 1 });
      await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt: now });
      await ctx.db.insert("roomMembers", { roomId: otherRoomId, userId: ownerId, role: "manager", createdAt: now });
      await ctx.db.insert("agents", {
        spaceId, roomId, createdBy: ownerId, creationKey: "search-agent", name: "Saathi",
        systemPrompt: "Be helpful", provider: "openrouter", model: MODEL_TIERS.med.model, status: "idle",
        createdAt: now, updatedAt: now,
      });
      const visibleMessageId = await ctx.db.insert("messages", {
        spaceId, roomId, authorUserId: ownerId, actorType: "user", origin: "app", originalText: "[Attachment]",
        language: "en", idempotencyKey: "visible-file", createdAt: now,
      });
      const hiddenMessageId = await ctx.db.insert("messages", {
        spaceId, roomId: otherRoomId, authorUserId: ownerId, actorType: "user", origin: "app", originalText: "[Attachment]",
        language: "en", idempotencyKey: "hidden-file", createdAt: now,
      });
      const visibleStorageId = await ctx.storage.store(new Blob(["visible"]));
      const hiddenStorageId = await ctx.storage.store(new Blob(["hidden"]));
      await ctx.db.insert("attachments", {
        spaceId, roomId, messageId: visibleMessageId, authorUserId: ownerId, storageId: visibleStorageId,
        fileName: "Electricity-April.pdf", mediaType: "application/pdf", sizeBytes: 7, transcript: "MSEDCL electricity bill ₹2,400", createdAt: now,
      });
      await ctx.db.insert("attachments", {
        spaceId, roomId: otherRoomId, messageId: hiddenMessageId, authorUserId: ownerId, storageId: hiddenStorageId,
        fileName: "Secret-electricity.pdf", mediaType: "application/pdf", sizeBytes: 6, transcript: "hidden electricity record", createdAt: now,
      });
      await ctx.db.insert("inboxItems", {
        spaceId, roomId, agentmailMessageId: "visible-mail", agentmailThreadId: "visible-thread", sender: "billing@example.test",
        subject: "April electricity bill", originalText: "Amount due ₹2,400", visibility: "private", privateOwnerId: ownerId,
        category: "bills", status: "ready", extractedAmount: "₹2,400", receivedAt: now,
      });
      await ctx.db.insert("inboxItems", {
        spaceId, roomId: otherRoomId, agentmailMessageId: "hidden-mail", agentmailThreadId: "hidden-thread", sender: "private@example.test",
        subject: "Secret electricity account", originalText: "Hidden", visibility: "private", privateOwnerId: ownerId,
        category: "bills", status: "ready", receivedAt: now,
      });
      return { ownerId, roomId };
    });
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });

    const files = await owner.mutation(api.conversationActions.execute, {
      roomId: seeded.roomId,
      action: { type: "find_room_files", query: "electricity" },
    });
    expect(files).toMatchObject({ ok: true });
    expect(files.message).toContain("Electricity-April.pdf");
    expect(files.message).not.toContain("Secret-electricity.pdf");

    const inbox = await owner.mutation(api.conversationActions.execute, {
      roomId: seeded.roomId,
      action: { type: "search_family_inbox", query: "electricity" },
    });
    expect(inbox).toMatchObject({ ok: true });
    expect(inbox.message).toContain("April electricity bill");
    expect(inbox.message).not.toContain("Secret electricity account");
  });
});
