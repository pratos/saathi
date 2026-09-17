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
});
