import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("family BYOK", () => {
  test("only owners can save a key, members see last four, and the secret is never returned", async () => {
    const t = convexTest(schema, modules);
    const { spaceId, ownerId, memberId } = await seedFamily(t);
    const owner = t.withIdentity({ subject: String(ownerId) });
    const member = t.withIdentity({ subject: String(memberId) });

    await expect(member.mutation(api.spaces.saveProviderKey, {
      spaceId, provider: "openai", secret: "sk-test-family-key-1234567890",
    })).rejects.toThrow(/permission/i);

    await owner.mutation(api.spaces.saveProviderKey, {
      spaceId, provider: "openai", secret: "sk-test-family-key-1234567890",
    });
    expect(await owner.query(api.spaces.providerKeyStatus, { spaceId })).toEqual([
      expect.objectContaining({ provider: "openai", lastFour: "7890" }),
    ]);
    const publicJson = JSON.stringify(await owner.query(api.spaces.providerKeyStatus, { spaceId }));
    expect(publicJson).not.toContain("sk-test-family-key-1234567890");
    expect(await t.query(internal.spaces.resolveProviderKey, { spaceId, provider: "openai" })).toBe("sk-test-family-key-1234567890");

    await owner.mutation(api.spaces.removeProviderKey, { spaceId, provider: "openai" });
    expect(await owner.query(api.spaces.providerKeyStatus, { spaceId })).toEqual([]);
    expect(await t.query(internal.spaces.resolveProviderKey, { spaceId, provider: "openai" })).toBeNull();
  });
});

async function seedFamily(t: TestConvex<typeof schema>) {
  return t.run(async ctx => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
    const memberId = await ctx.db.insert("users", { email: "member@example.test" });
    const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "byok-family", createdAt: now });
    await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
    await ctx.db.insert("memberships", { spaceId, userId: memberId, role: "member", status: "active", joinedAt: now });
    return { spaceId, ownerId, memberId } satisfies { spaceId: Id<"spaces">; ownerId: Id<"users">; memberId: Id<"users"> };
  });
}
