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

  test("lets configured superadmins use managed access without adding a family key", async () => {
    vi.stubEnv("SUPERADMIN_EMAILS", " owner@example.test, another-admin@example.test ");
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const seeded = await seedAccessFamily(t);
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });

    await expect(owner.query(api.admin.currentRole, {})).resolves.toEqual({ isSuperadmin: true });
    await expect(owner.query(api.spaces.aiAccess, { spaceId: seeded.spaceId })).resolves.toMatchObject({
      status: "approved",
      ready: true,
      source: "platform",
      hasOpenRouter: false,
      isSuperadmin: true,
    });
  });

  test("reports platform and family-funded costs separately by family and service", async () => {
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const seeded = await seedAccessFamily(t);
    const now = Date.UTC(2026, 8, 16);
    await t.run(async ctx => {
      await ctx.db.insert("usageLedger", {
        spaceId: seeded.spaceId, userId: seeded.ownerId, provider: "openai", model: "gpt-live-1",
        unit: "second", quantity: 60, costUsd: 0.05, costClass: "voice", billingSource: "platform", createdAt: now - 1_000,
      });
      await ctx.db.insert("usageLedger", {
        spaceId: seeded.spaceId, userId: seeded.ownerId, provider: "openai", model: "gpt-5.6-luna",
        unit: "token", quantity: 10_000, costUsd: 0.01, costClass: "voice_backend", billingSource: "platform", createdAt: now - 1_000,
      });
      await ctx.db.insert("usageLedger", {
        spaceId: seeded.spaceId, userId: seeded.ownerId, provider: "openrouter", model: "openai/gpt-5.6-luna",
        unit: "token", quantity: 20_000, costUsd: 0.02, costClass: "chat", billingSource: "family", createdAt: now - 1_000,
      });
      await ctx.db.insert("usageLedger", {
        spaceId: seeded.spaceId, userId: seeded.ownerId, provider: "openai", model: "gpt-5-mini",
        unit: "request", quantity: 1, costClass: "email_extraction", createdAt: now - 1_000,
      });
    });

    const admin = t.withIdentity({ subject: String(seeded.adminId) });
    const report = await admin.query(api.admin.usageOverview, { now });
    expect(report.totals.trackedCostUsd).toBeCloseTo(0.08);
    expect(report.totals.platformCostUsd).toBeCloseTo(0.06);
    expect(report.totals.familyByokCostUsd).toBeCloseTo(0.02);
    expect(report.totals.monthPlatformCostUsd).toBeCloseTo(0.06);
    expect(report.totals.projectedPlatformMonthlyUsd).toBeCloseTo(0.12);
    expect(report.totals.unknownCostRows).toBe(1);
    expect(report.rowLimitReached).toBe(false);
    expect(report.familyLimitReached).toBe(false);
    const family = report.families.find(item => item.spaceId === seeded.spaceId);
    expect(family).toMatchObject({ name: "Access Family", usageRows: 4 });
    expect(family?.trackedCostUsd).toBeCloseTo(0.08);
    expect(report.services.map(service => service.label)).toEqual(expect.arrayContaining([
      "GPT-Live 1 · voice session",
      "GPT-5.6 Luna · delegated voice work",
    ]));
  });

  test("keeps global totals complete when the family table reaches its display limit", async () => {
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const seeded = await seedAccessFamily(t);
    const now = Date.UTC(2026, 8, 16);
    await t.run(async ctx => {
      for (let index = 0; index < 201; index += 1) {
        const spaceId = await ctx.db.insert("spaces", {
          name: `Family ${index}`,
          createdBy: seeded.ownerId,
          creationKey: `usage-family-${index}`,
          createdAt: now - index,
        });
        await ctx.db.insert("usageLedger", {
          spaceId,
          userId: seeded.ownerId,
          provider: "openai",
          model: "gpt-live-1",
          unit: "second",
          quantity: 1,
          costUsd: 0.01,
          costClass: "voice",
          billingSource: "platform",
          createdAt: now - index,
        });
      }
    });

    const admin = t.withIdentity({ subject: String(seeded.adminId) });
    const report = await admin.query(api.admin.usageOverview, { now });
    expect(report.trackedRows).toBe(201);
    expect(report.families).toHaveLength(200);
    expect(report.familyLimitReached).toBe(true);
    expect(report.totals.trackedCostUsd).toBeCloseTo(2.01);
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
    await expect(member.query(api.admin.usageOverview, { now: Date.now() })).rejects.toThrow(/Superadmin/);
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
