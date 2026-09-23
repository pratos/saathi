import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { adminAccessDigest } from "./lib/adminAccess.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

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

  test("grants the configured admin reviewer superadmin access", async () => {
    vi.stubEnv("ADMIN_REVIEW_EMAIL", " owner@example.test ");
    vi.stubEnv("ADMIN_REVIEW_CODE_SHA256", "configured-reviewer-digest");
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const seeded = await seedAccessFamily(t);
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });

    await expect(owner.query(api.admin.currentRole, {})).resolves.toEqual({ isSuperadmin: false });
    await t.run(async ctx => ctx.db.patch(seeded.ownerId, { adminReviewer: true }));
    await expect(owner.query(api.admin.currentRole, {})).resolves.toEqual({ isSuperadmin: true });
    await owner.mutation(api.users.ensureCurrent, {});
    await expect(t.run(async ctx => (await ctx.db.get(seeded.ownerId))?.platformRole)).resolves.toBeNull();
    await expect(owner.query(api.admin.emailOperations, { now: Date.now() })).resolves.toMatchObject({
      inbox: { sampled: 0 },
    });

    vi.stubEnv("ADMIN_REVIEW_CODE_SHA256", "");
    await expect(owner.query(api.admin.currentRole, {})).resolves.toEqual({ isSuperadmin: false });
    await expect(owner.query(api.admin.emailOperations, { now: Date.now() })).rejects.toThrow(/Superadmin/);

    vi.stubEnv("ADMIN_REVIEW_CODE_SHA256", "configured-reviewer-digest");
    vi.stubEnv("ADMIN_REVIEW_EMAIL", "");
    await expect(owner.query(api.admin.currentRole, {})).resolves.toEqual({ isSuperadmin: false });
    await expect(owner.query(api.admin.emailOperations, { now: Date.now() })).rejects.toThrow(/Superadmin/);
  });

  test("creates and reuses the fixed reviewer account with valid credentials", async () => {
    const email = "reviewer@example.test";
    const code = "test-only-review-code-with-high-entropy";
    vi.stubEnv("ADMIN_REVIEW_EMAIL", email);
    vi.stubEnv("ADMIN_REVIEW_CODE_SHA256", await adminAccessDigest(email, code));
    const t = convexTest(schema, modules);
    rateLimiter.register(t);

    // convex-test does not provision Convex Auth's JWT signing key. The
    // credential provider and account mutations complete before token signing.
    await expect(t.action(api.auth.signIn, { provider: "saathi-admin", params: { email, code } })).rejects.toThrow(/JWT_PRIVATE_KEY/);
    await expect(t.action(api.auth.signIn, { provider: "saathi-admin", params: { email, code } })).rejects.toThrow(/JWT_PRIVATE_KEY/);
    const users = await t.run(async ctx => (await ctx.db.query("users").collect()).filter(user => user.email === email));
    expect(users).toHaveLength(1);
    expect(users[0]?.adminReviewer).toBe(true);
    expect(users[0]?.accessStatus).toBe("pending");
    await expect(t.run(async ctx => (await ctx.db.query("authAccounts").collect()).filter(account => account.providerAccountId === email))).resolves.toHaveLength(1);
    const reviewer = t.withIdentity({ subject: String(users[0]!._id) });
    await expect(reviewer.query(api.admin.currentRole, {})).resolves.toEqual({ isSuperadmin: true });
    vi.stubEnv("ADMIN_REVIEW_CODE_SHA256", "");
    await expect(reviewer.query(api.admin.currentRole, {})).resolves.toEqual({ isSuperadmin: false });
  });

  test("keeps reviewer-code and ordinary email OTP identities separate in either creation order", async () => {
    const email = "reviewer-linking@example.test";
    const code = "test-only-review-code-for-linking-order";
    vi.stubEnv("ADMIN_REVIEW_EMAIL", email);
    vi.stubEnv("ADMIN_REVIEW_CODE_SHA256", await adminAccessDigest(email, code));
    vi.stubEnv("AGENTMAIL_API_KEY", "test-agentmail-key");
    vi.stubEnv("AGENTMAIL_AUTH_INBOX_ID", "test-auth-inbox");
    vi.stubEnv("SITE_URL", "https://saathi.example.test");

    for (const reviewerFirst of [true, false]) {
      const t = convexTest(schema, modules);
      rateLimiter.register(t);
      const reviewerSignIn = () => t.action(api.auth.signIn, { provider: "saathi-admin", params: { email, code } });
      if (reviewerFirst) await expect(reviewerSignIn()).rejects.toThrow(/JWT_PRIVATE_KEY/);
      await completeEmailOtpSignIn(t, email);
      if (!reviewerFirst) await expect(reviewerSignIn()).rejects.toThrow(/JWT_PRIVATE_KEY/);

      const accounts = await t.run(async ctx => ctx.db.query("authAccounts").collect());
      const reviewerAccount = accounts.find(account => account.provider === "saathi-admin");
      const otpAccount = accounts.find(account => account.provider === "saath-email");
      expect(reviewerAccount?.userId).toBeDefined();
      expect(otpAccount?.userId).toBeDefined();
      expect(reviewerAccount?.userId).not.toBe(otpAccount?.userId);

      const reviewer = t.withIdentity({ subject: String(reviewerAccount!.userId) });
      const otpUser = t.withIdentity({ subject: String(otpAccount!.userId) });
      await expect(reviewer.query(api.admin.currentRole, {})).resolves.toEqual({ isSuperadmin: true });
      await expect(otpUser.query(api.admin.currentRole, {})).resolves.toEqual({ isSuperadmin: false });
    }
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

  test("gives superadmins bounded email operations without exposing message content or OTP values", async () => {
    vi.stubEnv("AGENTMAIL_API_KEY", "configured-agentmail-key");
    vi.stubEnv("AGENTMAIL_AUTH_INBOX_ID", "auth-inbox");
    vi.stubEnv("COMPOSIO_API_KEY", "configured-composio-key");
    vi.stubEnv("COMPOSIO_WEBHOOK_SECRET", "configured-webhook-secret");
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const seeded = await seedAccessFamily(t);
    const receivedAt = Date.UTC(2026, 8, 22, 12);
    await t.run(async ctx => {
      await ctx.db.patch(seeded.spaceId, {
        agentmailInboxId: "family-inbox",
        agentmailEmail: "family@example.test",
        otpSharingEnabled: true,
      });
      await ctx.db.insert("spaces", {
        name: "Default OTP family",
        createdBy: seeded.ownerId,
        creationKey: "default-otp-family",
        createdAt: receivedAt - 10,
      });
      await ctx.db.insert("spaces", {
        name: "Disabled OTP family",
        createdBy: seeded.ownerId,
        creationKey: "disabled-otp-family",
        createdAt: receivedAt - 20,
        otpSharingEnabled: false,
      });
      await ctx.db.insert("gmailConnections", {
        spaceId: seeded.spaceId,
        userId: seeded.ownerId,
        connectedAccountId: "gmail-admin-test",
        alias: "Private Gmail",
        email: "owner@example.test",
        triggerId: "gmail-trigger",
        status: "active",
        createdAt: receivedAt,
      });
      const privateSourceMessageId = await ctx.db.insert("messages", {
        spaceId: seeded.spaceId,
        roomId: seeded.roomId,
        actorType: "email_guest",
        origin: "assistant",
        originalText: "Private Gmail summary",
        language: "en",
        idempotencyKey: "private-gmail-summary",
        createdAt: receivedAt,
      });
      await ctx.db.insert("inboxItems", {
        spaceId: seeded.spaceId,
        agentmailMessageId: "private-otp",
        agentmailThreadId: "private-thread",
        sender: "security@example.test",
        subject: "Sensitive sign-in subject",
        originalText: "Sensitive body with code 739201",
        visibility: "private",
        privateOwnerId: seeded.ownerId,
        category: "security",
        subcategory: "otp",
        status: "ready",
        extractedOtpCode: "739201",
        ephemeralExpiresAt: receivedAt + 300_000,
        sourceMessageId: privateSourceMessageId,
        receivedAt,
      });
      await ctx.db.insert("inboxItems", {
        spaceId: seeded.spaceId,
        agentmailMessageId: "shared-receipt",
        agentmailThreadId: "shared-thread",
        sender: "billing@example.test",
        subject: "Sensitive receipt subject",
        originalText: "Sensitive receipt body",
        visibility: "space",
        category: "subscriptions",
        subcategory: "subscription_renewal",
        status: "failed",
        extractedAmountInr: "₹9,977.07",
        receivedAt: receivedAt - 1_000,
      });
      await ctx.db.insert("inboxItems", {
        spaceId: seeded.spaceId,
        agentmailMessageId: "family-forward",
        agentmailThreadId: "family-forward-thread",
        sender: "travel@example.test",
        subject: "Sensitive shared itinerary",
        originalText: "Sensitive shared travel body",
        visibility: "space",
        category: "travel",
        status: "ready",
        sharedAt: receivedAt - 1_500,
        sharedByUserId: seeded.ownerId,
        receivedAt: receivedAt - 1_500,
      });
      await ctx.db.insert("inboxItems", {
        spaceId: seeded.spaceId,
        agentmailMessageId: "expired-private-otp",
        agentmailThreadId: "expired-private-thread",
        sender: "archive@example.test",
        subject: "Expired sensitive subject",
        originalText: "Expired sensitive body with code 114477",
        visibility: "private",
        privateOwnerId: seeded.ownerId,
        category: "security",
        subcategory: "otp",
        status: "ready",
        extractedOtpCode: "114477",
        ephemeralExpiresAt: receivedAt - 1,
        receivedAt: receivedAt - 2_000,
      });
    });

    const admin = t.withIdentity({ subject: String(seeded.adminId) });
    const report = await admin.query(api.admin.emailOperations, { now: receivedAt + 60_000 });
    expect(report.configuration).toEqual({ agentmail: true, authDelivery: true, gmail: true, gmailWebhook: true });
    expect(report.inbox).toMatchObject({ sampled: 4, ready: 3, failed: 1, private: 2, shared: 2, forwarded: 1, otp: 1, withAmount: 1 });
    expect(report.gmail).toMatchObject({ active: 1, error: 0, sampled: 1 });
    expect(report.families).toMatchObject({ sampled: 3, withAgentmail: 1, otpSharingEnabled: 2 });
    expect(report.recent).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "gmail", sender: "s•••••@example.test", isOtp: true }),
      expect.objectContaining({ source: "agentmail", sender: "b•••••@example.test", hasAmount: true }),
      expect.objectContaining({ source: "family_share", sender: "t•••••@example.test" }),
    ]));
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("739201");
    expect(serialized).not.toContain("114477");
    expect(serialized).not.toContain("Sensitive");
    expect(serialized).not.toContain("security@example.test");
  });

  test("records requests and restricts access decisions to superadmins", async () => {
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const seeded = await seedAccessFamily(t);
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    const member = t.withIdentity({ subject: String(seeded.memberId) });
    const admin = t.withIdentity({ subject: String(seeded.adminId) });

    await owner.mutation(api.users.requestAccess, {});
    await expect(owner.query(api.spaces.aiAccess, { spaceId: seeded.spaceId })).resolves.toMatchObject({
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
    await expect(owner.query(api.spaces.aiAccess, { spaceId: seeded.spaceId })).resolves.toMatchObject({ status: "approved" });
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

async function completeEmailOtpSignIn(t: TestConvex<typeof schema>, email: string) {
  let token = "";
  vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as { text?: string };
    token = payload.text?.match(/code is: (\d{6})/)?.[1] ?? "";
    return new Response(null, { status: 200 });
  }));
  await expect(t.action(api.auth.signIn, { provider: "saath-email", params: { email } })).resolves.toMatchObject({ started: true });
  expect(token).toMatch(/^\d{6}$/);
  await expect(t.action(api.auth.signIn, { provider: "saath-email", params: { email, code: token } })).rejects.toThrow(/JWT_PRIVATE_KEY/);
}
