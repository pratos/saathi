import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

afterEach(() => vi.unstubAllEnvs());

describe("AI access onboarding", () => {
  test("allows family BYOK or approved platform access and lets blocked status override BYOK", async () => {
    vi.stubEnv("BYOK_ENCRYPTION_KEY", "test-only-byok-encryption-key");
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const seeded = await seedAccessFamily(t);
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    const member = t.withIdentity({ subject: String(seeded.memberId) });

    await expect(owner.query(api.spaces.aiAccess, { spaceId: seeded.spaceId })).resolves.toMatchObject({
      status: "pending",
      ready: false,
      source: "none",
      hasOpenRouter: false,
    });
    await expect(owner.mutation(api.messages.post, {
      roomId: seeded.roomId,
      text: "@saathi hello",
      language: "en",
      clientOperationId: "pending-no-key",
    })).rejects.toThrow(/Add your own API key or request access/);

    await owner.mutation(api.spaces.saveProviderKey, {
      spaceId: seeded.spaceId,
      provider: "openrouter",
      secret: "sk-or-v1-test-family-key-1234567890",
    });
    await expect(owner.query(api.spaces.aiAccess, { spaceId: seeded.spaceId })).resolves.toMatchObject({
      status: "pending",
      ready: true,
      source: "byok",
      hasOpenRouter: true,
    });
    await owner.mutation(api.spaces.setModelTier, { spaceId: seeded.spaceId, tier: "high" });
    await expect(t.query(internal.spaces.resolveDecisionCredential, {
      spaceId: seeded.spaceId,
      userId: seeded.ownerId,
    })).resolves.toMatchObject({
      ownedOpenRouterSecret: "sk-or-v1-test-family-key-1234567890",
      openRouterModel: "x-ai/grok-4.6",
      platformAllowed: false,
      blocked: false,
    });
    await expect(owner.mutation(api.messages.post, {
      roomId: seeded.roomId,
      text: "@saathi hello",
      language: "en",
      clientOperationId: "pending-with-key",
    })).resolves.toBeDefined();

    const admin = t.withIdentity({ subject: String(seeded.adminId) });
    await admin.mutation(api.admin.setAccessStatus, { userId: seeded.memberId, status: "approved" });
    await owner.mutation(api.spaces.removeProviderKey, { spaceId: seeded.spaceId, provider: "openrouter" });
    await expect(member.query(api.spaces.aiAccess, { spaceId: seeded.spaceId })).resolves.toMatchObject({
      status: "approved",
      ready: true,
      source: "platform",
    });

    await admin.mutation(api.admin.setAccessStatus, { userId: seeded.ownerId, status: "blocked" });
    await owner.mutation(api.spaces.saveProviderKey, {
      spaceId: seeded.spaceId,
      provider: "openrouter",
      secret: "sk-or-v1-another-family-key-1234567890",
    });
    await expect(owner.query(api.spaces.aiAccess, { spaceId: seeded.spaceId })).resolves.toMatchObject({
      status: "blocked",
      ready: false,
      source: "none",
      hasOpenRouter: true,
    });
    await expect(owner.mutation(api.messages.post, {
      roomId: seeded.roomId,
      text: "@saathi blocked",
      language: "en",
      clientOperationId: "blocked-with-key",
    })).rejects.toThrow(/blocked/i);
  });

  test("records requests and restricts access decisions to superadmins", async () => {
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const seeded = await seedAccessFamily(t);
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    const member = t.withIdentity({ subject: String(seeded.memberId) });
    const admin = t.withIdentity({ subject: String(seeded.adminId) });

    await owner.mutation(api.users.requestAccess, {});
    await expect(owner.query(api.users.accessOverview, {})).resolves.toMatchObject({
      status: "pending",
      requestedAt: expect.any(Number),
    });
    await expect(member.query(api.admin.listUsers, {})).rejects.toThrow(/Superadmin/);
    await expect(member.mutation(api.admin.setAccessStatus, {
      userId: seeded.ownerId,
      status: "approved",
    })).rejects.toThrow(/Superadmin/);

    const users = await admin.query(api.admin.listUsers, {});
    expect(users).toEqual(expect.arrayContaining([
      expect.objectContaining({ _id: seeded.ownerId, status: "pending", requestedAt: expect.any(Number) }),
      expect.objectContaining({ _id: seeded.adminId, status: "approved", isSuperadmin: true }),
    ]));
    await admin.mutation(api.admin.setAccessStatus, { userId: seeded.ownerId, status: "approved" });
    await expect(owner.query(api.users.accessOverview, {})).resolves.toMatchObject({ status: "approved" });
  });
});

async function seedAccessFamily(t: TestConvex<typeof schema>) {
  return t.run(async ctx => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { email: "owner@example.test", accessStatus: "pending" });
    const memberId = await ctx.db.insert("users", { email: "member@example.test", accessStatus: "pending" });
    const adminId = await ctx.db.insert("users", {
      email: "admin@example.test",
      platformRole: "superadmin",
      accessStatus: "approved",
    });
    const spaceId = await ctx.db.insert("spaces", {
      name: "Access Family",
      createdBy: ownerId,
      creationKey: "access-family",
      createdAt: now,
    });
    await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
    await ctx.db.insert("memberships", { spaceId, userId: memberId, role: "member", status: "active", joinedAt: now });
    const roomId = await ctx.db.insert("rooms", {
      spaceId,
      type: "shared",
      title: "Family",
      assistantMode: "mention",
      createdBy: ownerId,
      createdAt: now,
    });
    await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt: now });
    await ctx.db.insert("roomMembers", { roomId, userId: memberId, role: "participant", createdAt: now });
    return { ownerId, memberId, adminId, spaceId, roomId } satisfies {
      ownerId: Id<"users">;
      memberId: Id<"users">;
      adminId: Id<"users">;
      spaceId: Id<"spaces">;
      roomId: Id<"rooms">;
    };
  });
}
