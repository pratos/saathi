import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

afterEach(() => vi.unstubAllEnvs());

describe("family BYOK", () => {
  test("only owners can save a key, members see last four, and the secret is never returned", async () => {
    vi.stubEnv("BYOK_ENCRYPTION_KEY", "test-only-byok-encryption-key");
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
    expect(await t.query(internal.spaces.resolveProviderCredential, { spaceId, userId: ownerId, provider: "openai" })).toMatchObject({ ownedSecret: "sk-test-family-key-1234567890" });
    expect(await t.run(async ctx => (await ctx.db.query("providerKeys").unique())?.sealedSecret)).toMatch(/^v2:/);

    await owner.mutation(api.spaces.removeProviderKey, { spaceId, provider: "openai" });
    expect(await owner.query(api.spaces.providerKeyStatus, { spaceId })).toEqual([]);
    expect(await t.query(internal.spaces.resolveProviderCredential, { spaceId, userId: ownerId, provider: "openai" })).toMatchObject({ ownedSecret: null });

    const legacySecret = "sk-test-legacy-family-key-1234567890";
    await t.run(async ctx => {
      await ctx.db.insert("providerKeys", {
        spaceId,
        provider: "openai",
        sealedSecret: await legacySeal(legacySecret),
        lastFour: "7890",
        updatedBy: ownerId,
        updatedAt: Date.now(),
      });
    });
    expect(await t.query(internal.spaces.resolveProviderCredential, { spaceId, userId: ownerId, provider: "openai" })).toMatchObject({ ownedSecret: legacySecret });
  });
});

async function legacySeal(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("saathi-byok:saathi-local-byok"));
  const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret));
  const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${toHex(iv)}:${toHex(new Uint8Array(encrypted))}`;
}

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
