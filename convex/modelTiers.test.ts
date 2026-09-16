import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import { DEFAULT_MODEL_TIER, MODEL_TIERS, resolveModelTier } from "./lib/modelTiers.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("family model tiers", () => {
  test("defaults to medium Luna and lets owners change the family agent model", async () => {
    expect(DEFAULT_MODEL_TIER).toBe("med");
    expect(resolveModelTier(undefined).model).toBe(MODEL_TIERS.med.model);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const createdAt = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const memberId = await ctx.db.insert("users", { email: "member@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "tier-family", createdAt });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: createdAt });
      await ctx.db.insert("memberships", { spaceId, userId: memberId, role: "member", status: "active", joinedAt: createdAt });
      const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family conversation", assistantMode: "mention", createdBy: ownerId, createdAt });
      await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt });
      await ctx.db.insert("roomMembers", { roomId, userId: memberId, role: "participant", createdAt });
      await ctx.db.insert("agents", {
        spaceId, roomId, createdBy: ownerId, creationKey: "saathi-default", name: "Saathi",
        systemPrompt: "Be helpful", provider: "openrouter", model: MODEL_TIERS.med.model, status: "idle",
        createdAt, updatedAt: createdAt,
      });
      return { ownerId, memberId, spaceId };
    });
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    const member = t.withIdentity({ subject: String(seeded.memberId) });
    await expect(member.mutation(api.spaces.setModelTier, { spaceId: seeded.spaceId, tier: "high" })).rejects.toThrow(/permission/i);
    await owner.mutation(api.spaces.setModelTier, { spaceId: seeded.spaceId, tier: "low" });
    const space = await t.run(ctx => ctx.db.get(seeded.spaceId));
    expect(space?.modelTier).toBe("low");
    const agent = await t.run(async ctx => ctx.db.query("agents").first());
    expect(agent?.model).toBe(MODEL_TIERS.low.model);
  });
});
