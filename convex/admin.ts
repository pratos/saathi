import { ConvexError, v } from "convex/values";
import { env, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireUser } from "./lib/authz";
import { effectiveAccessStatus, isSuperadminUser } from "./lib/platformAccess";

const accessStatus = v.union(v.literal("pending"), v.literal("approved"), v.literal("blocked"));

async function requireSuperadmin(ctx: QueryCtx | MutationCtx) {
  const principal = await requireUser(ctx);
  if (!isSuperadminUser(principal.user)) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Superadmin access required" });
  }
  return principal;
}

export const currentRole = query({
  args: {},
  returns: v.object({ isSuperadmin: v.boolean() }),
  handler: async (ctx) => ({ isSuperadmin: isSuperadminUser((await requireUser(ctx)).user) }),
});

export const listUsers = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("users"),
    createdAt: v.number(),
    email: v.string(),
    name: v.string(),
    status: accessStatus,
    requestedAt: v.union(v.number(), v.null()),
    reviewedAt: v.union(v.number(), v.null()),
    note: v.union(v.string(), v.null()),
    isSuperadmin: v.boolean(),
  })),
  handler: async (ctx) => {
    await requireSuperadmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(200);
    return users.map(user => ({
      _id: user._id,
      createdAt: user._creationTime,
      email: user.email ?? "No email",
      name: user.displayName ?? user.name ?? user.username ?? "New account",
      status: effectiveAccessStatus(user),
      requestedAt: user.accessRequestedAt ?? null,
      reviewedAt: user.accessReviewedAt ?? null,
      note: user.accessNote ?? null,
      isSuperadmin: isSuperadminUser(user),
    }));
  },
});

const recategorizationStatus = v.union(
  v.literal("queued"), v.literal("running"), v.literal("complete"), v.literal("failed"),
);

export const recentRecategorizations = query({
  args: {},
  returns: v.array(v.object({
    jobId: v.id("inboxRecategorizationJobs"),
    familyName: v.string(),
    status: recategorizationStatus,
    startedAt: v.number(),
    updatedAt: v.number(),
    discovered: v.number(),
    recategorized: v.number(),
    skipped: v.number(),
    error: v.union(v.string(), v.null()),
  })),
  handler: async (ctx) => {
    await requireSuperadmin(ctx);
    const jobs = await ctx.db.query("inboxRecategorizationJobs").order("desc").take(100);
    return Promise.all(jobs.map(async job => ({
      jobId: job._id,
      familyName: (await ctx.db.get(job.spaceId))?.name ?? "Deleted family",
      status: job.status,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      discovered: job.discovered,
      recategorized: job.recategorized,
      skipped: job.skipped,
      error: job.error ?? null,
    })));
  },
});

const pipelineStatus = v.union(
  v.literal("received"), v.literal("processing"), v.literal("ready"), v.literal("failed"),
);

export const emailOperations = query({
  args: { now: v.number() },
  returns: v.object({
    configuration: v.object({
      agentmail: v.boolean(),
      authDelivery: v.boolean(),
      gmail: v.boolean(),
      gmailWebhook: v.boolean(),
    }),
    inbox: v.object({
      sampled: v.number(),
      received: v.number(),
      processing: v.number(),
      ready: v.number(),
      failed: v.number(),
      private: v.number(),
      shared: v.number(),
      forwarded: v.number(),
      otp: v.number(),
      withAmount: v.number(),
    }),
    gmail: v.object({ active: v.number(), error: v.number(), sampled: v.number() }),
    families: v.object({ sampled: v.number(), withAgentmail: v.number(), otpSharingEnabled: v.number() }),
    categories: v.array(v.object({ category: v.string(), count: v.number() })),
    recent: v.array(v.object({
      itemId: v.id("inboxItems"),
      familyName: v.string(),
      source: v.union(v.literal("gmail"), v.literal("agentmail"), v.literal("family_share")),
      sender: v.string(),
      status: pipelineStatus,
      category: v.string(),
      subcategory: v.union(v.string(), v.null()),
      receivedAt: v.number(),
      hasAmount: v.boolean(),
      hasDueDate: v.boolean(),
      parseStatus: v.union(v.string(), v.null()),
      isOtp: v.boolean(),
      expiresAt: v.union(v.number(), v.null()),
    })),
    limits: v.object({ inbox: v.boolean(), gmail: v.boolean(), families: v.boolean() }),
  }),
  handler: async (ctx, { now }) => {
    await requireSuperadmin(ctx);
    if (!Number.isFinite(now) || now < 0 || now > 8_640_000_000_000_000) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid reporting time" });
    }

    const [inboxPage, gmailPage, spacePage] = await Promise.all([
      ctx.db.query("inboxItems").order("desc").take(501),
      ctx.db.query("gmailConnections").order("desc").take(201),
      ctx.db.query("spaces").order("desc").take(201),
    ]);
    const inboxItems = inboxPage.slice(0, 500);
    const gmailConnections = gmailPage.slice(0, 200);
    const spaces = spacePage.slice(0, 200);
    const spacesById = new Map(spaces.map(space => [String(space._id), space]));
    const statusCounts = { received: 0, processing: 0, ready: 0, failed: 0 };
    const categoryCounts = new Map<string, number>();
    let privateCount = 0;
    let sharedCount = 0;
    let forwardedCount = 0;
    let otpCount = 0;
    let withAmountCount = 0;

    for (const item of inboxItems) {
      statusCounts[item.status] += 1;
      categoryCounts.set(item.category, (categoryCounts.get(item.category) ?? 0) + 1);
      if (item.visibility === "private") privateCount += 1;
      else sharedCount += 1;
      if (item.sharedAt !== undefined) forwardedCount += 1;
      if (item.extractedOtpCode !== undefined && item.ephemeralExpiresAt !== undefined && item.ephemeralExpiresAt > now) otpCount += 1;
      if (item.extractedAmount || item.extractedAmountInr || item.extractedAmountUsd) withAmountCount += 1;
    }

    return {
      configuration: {
        agentmail: Boolean(env.AGENTMAIL_API_KEY?.trim()),
        authDelivery: Boolean(env.AGENTMAIL_AUTH_INBOX_ID?.trim()),
        gmail: Boolean(env.COMPOSIO_API_KEY?.trim()),
        gmailWebhook: Boolean(env.COMPOSIO_WEBHOOK_SECRET?.trim()),
      },
      inbox: {
        sampled: inboxItems.length,
        ...statusCounts,
        private: privateCount,
        shared: sharedCount,
        forwarded: forwardedCount,
        otp: otpCount,
        withAmount: withAmountCount,
      },
      gmail: {
        active: gmailConnections.filter(connection => connection.status === "active").length,
        error: gmailConnections.filter(connection => connection.status === "error").length,
        sampled: gmailConnections.length,
      },
      families: {
        sampled: spaces.length,
        withAgentmail: spaces.filter(space => Boolean(space.agentmailInboxId)).length,
        otpSharingEnabled: spaces.filter(space => space.otpSharingEnabled !== false).length,
      },
      categories: [...categoryCounts.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category)),
      recent: inboxItems.slice(0, 25).map(item => ({
        itemId: item._id,
        familyName: spacesById.get(String(item.spaceId))?.name ?? "Family outside sample",
        source: item.sharedAt !== undefined ? "family_share" as const : item.visibility === "private" ? "gmail" as const : "agentmail" as const,
        sender: maskEmail(item.sender),
        status: item.status,
        category: item.category,
        subcategory: item.subcategory ?? null,
        receivedAt: item.receivedAt,
        hasAmount: Boolean(item.extractedAmount || item.extractedAmountInr || item.extractedAmountUsd),
        hasDueDate: item.extractedDueAt !== undefined,
        parseStatus: item.documentParseStatus ?? null,
        isOtp: item.extractedOtpCode !== undefined,
        expiresAt: item.ephemeralExpiresAt ?? null,
      })),
      limits: {
        inbox: inboxPage.length > inboxItems.length,
        gmail: gmailPage.length > gmailConnections.length,
        families: spacePage.length > spaces.length,
      },
    };
  },
});

const usageTotalsFields = {
  trackedCostUsd: v.number(),
  platformCostUsd: v.number(),
  familyByokCostUsd: v.number(),
  monthCostUsd: v.number(),
  monthPlatformCostUsd: v.number(),
  projectedMonthlyCostUsd: v.number(),
  projectedPlatformMonthlyUsd: v.number(),
  unknownCostRows: v.number(),
};
const usageTotalsValidator = v.object(usageTotalsFields);

const usageBreakdownValidator = v.object({
  key: v.string(),
  label: v.string(),
  trackedCostUsd: v.number(),
  monthCostUsd: v.number(),
  platformCostUsd: v.number(),
  familyByokCostUsd: v.number(),
  quantity: v.number(),
  unit: v.string(),
  usageRows: v.number(),
  unknownCostRows: v.number(),
});

export const usageOverview = query({
  args: { now: v.number() },
  returns: v.object({
    asOf: v.number(),
    monthStartedAt: v.number(),
    trackedRows: v.number(),
    rowLimitReached: v.boolean(),
    familyLimitReached: v.boolean(),
    totals: usageTotalsValidator,
    families: v.array(v.object({
      spaceId: v.id("spaces"),
      name: v.string(),
      modelTier: v.union(v.literal("low"), v.literal("med"), v.literal("high"), v.literal("ultra")),
      ...usageTotalsFields,
      usageRows: v.number(),
    })),
    services: v.array(usageBreakdownValidator),
    convexDashboardUrl: v.string(),
  }),
  handler: async (ctx, { now }) => {
    await requireSuperadmin(ctx);
    if (!Number.isFinite(now) || now < 0 || now > 8_640_000_000_000_000) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid reporting time" });
    }
    const ledgerPage = await ctx.db.query("usageLedger").order("desc").take(5_001);
    const ledger = ledgerPage.slice(0, 5_000);
    const familySpaceIds = [...new Set(ledger.map(row => row.spaceId))];
    const visibleFamilyIds = familySpaceIds.slice(0, 200);
    const spaces = (await Promise.all(visibleFamilyIds.map(spaceId => ctx.db.get(spaceId))))
      .filter(space => space !== null);
    const monthStartedAt = startOfUtcMonth(now);
    const monthProgress = Math.max(1, (now - monthStartedAt) / 86_400_000);
    const nowDate = new Date(now);
    const daysInMonth = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() + 1, 0)).getUTCDate();
    const projectMonth = (cost: number) => cost / monthProgress * daysInMonth;
    const empty = () => ({
      trackedCostUsd: 0,
      platformCostUsd: 0,
      familyByokCostUsd: 0,
      monthCostUsd: 0,
      monthPlatformCostUsd: 0,
      projectedMonthlyCostUsd: 0,
      projectedPlatformMonthlyUsd: 0,
      unknownCostRows: 0,
    });
    const totals = empty();
    const familyMap = new Map(spaces.map(space => [String(space._id), {
      spaceId: space._id,
      name: space.name,
      modelTier: space.modelTier ?? "med",
      ...empty(),
      usageRows: 0,
    }]));
    const serviceMap = new Map<string, {
      key: string;
      label: string;
      trackedCostUsd: number;
      monthCostUsd: number;
      platformCostUsd: number;
      familyByokCostUsd: number;
      quantity: number;
      unit: string;
      usageRows: number;
      unknownCostRows: number;
    }>();
    for (const row of ledger) {
      const family = familyMap.get(String(row.spaceId));
      if (family) family.usageRows += 1;
      const serviceKey = `${row.costClass}:${row.provider}:${row.model ?? "unknown"}`;
      const service = serviceMap.get(serviceKey) ?? {
        key: serviceKey,
        label: usageServiceLabel(row.costClass, row.model, row.provider),
        trackedCostUsd: 0,
        monthCostUsd: 0,
        platformCostUsd: 0,
        familyByokCostUsd: 0,
        quantity: 0,
        unit: row.unit,
        usageRows: 0,
        unknownCostRows: 0,
      };
      service.quantity += finiteNonnegative(row.quantity);
      service.usageRows += 1;
      if (row.costUsd === undefined || !Number.isFinite(row.costUsd)) {
        totals.unknownCostRows += 1;
        if (family) family.unknownCostRows += 1;
        service.unknownCostRows += 1;
        serviceMap.set(serviceKey, service);
        continue;
      }
      const cost = finiteNonnegative(row.costUsd);
      const isFamilyByok = row.billingSource === "family";
      totals.trackedCostUsd += cost;
      if (family) family.trackedCostUsd += cost;
      service.trackedCostUsd += cost;
      if (isFamilyByok) {
        totals.familyByokCostUsd += cost;
        if (family) family.familyByokCostUsd += cost;
        service.familyByokCostUsd += cost;
      } else {
        totals.platformCostUsd += cost;
        if (family) family.platformCostUsd += cost;
        service.platformCostUsd += cost;
      }
      if (row.createdAt >= monthStartedAt && row.createdAt <= now) {
        totals.monthCostUsd += cost;
        if (family) family.monthCostUsd += cost;
        service.monthCostUsd += cost;
        if (!isFamilyByok) {
          totals.monthPlatformCostUsd += cost;
          if (family) family.monthPlatformCostUsd += cost;
        }
      }
      serviceMap.set(serviceKey, service);
    }
    totals.projectedMonthlyCostUsd = projectMonth(totals.monthCostUsd);
    totals.projectedPlatformMonthlyUsd = projectMonth(totals.monthPlatformCostUsd);
    const families = [...familyMap.values()].map(family => ({
      ...family,
      projectedMonthlyCostUsd: projectMonth(family.monthCostUsd),
      projectedPlatformMonthlyUsd: projectMonth(family.monthPlatformCostUsd),
    })).sort((left, right) => right.monthCostUsd - left.monthCostUsd || left.name.localeCompare(right.name));
    const services = [...serviceMap.values()]
      .sort((left, right) => right.monthCostUsd - left.monthCostUsd || left.label.localeCompare(right.label));
    return {
      asOf: now,
      monthStartedAt,
      trackedRows: ledger.length,
      rowLimitReached: ledgerPage.length > ledger.length,
      familyLimitReached: familySpaceIds.length > visibleFamilyIds.length,
      totals,
      families,
      services,
      convexDashboardUrl: "https://dashboard.convex.dev/",
    };
  },
});

export const setAccessStatus = mutation({
  args: { userId: v.id("users"), status: accessStatus, note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId: reviewerId } = await requireSuperadmin(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
    if (isSuperadminUser(user) && args.status !== "approved") {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "A superadmin cannot be blocked" });
    }
    const note = args.note?.trim();
    if (note && note.length > 500) throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Note is too long" });
    const now = Date.now();
    await ctx.db.patch(args.userId, {
      accessStatus: args.status,
      accessReviewedAt: now,
      accessReviewedBy: reviewerId,
      accessNote: note || undefined,
    });
    await ctx.db.insert("auditEvents", {
      actorUserId: reviewerId,
      action: `admin.access_${args.status}`,
      resourceType: "user",
      resourceId: String(args.userId),
      metadata: note ? { note } : undefined,
      createdAt: now,
    });
    return null;
  },
});

function startOfUtcMonth(now: number) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function finiteNonnegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function maskEmail(value: string) {
  const match = value.trim().match(/^([^@\s]+)@([^@\s]+)$/);
  if (!match) return "Non-email sender";
  const [, local, domain] = match;
  return `${local.slice(0, 1)}${"•".repeat(Math.min(5, Math.max(2, local.length - 1)))}@${domain}`;
}

function usageServiceLabel(costClass: string, model: string | undefined, provider: string) {
  if (costClass === "voice") return "GPT-Live 1 · voice session";
  if (costClass === "voice_backend") return "GPT-5.6 Luna · delegated voice work";
  if (costClass === "voice_summary") return "GPT-5.6 Luna · post-call summary";
  if (costClass === "voice_backend_tool") return "OpenAI web search · delegated voice tool";
  if (costClass === "chat") return `${model ?? "Text model"} · chat`;
  if (costClass === "email_extraction") return `${model ?? "Text model"} · email extraction`;
  return `${model ?? provider} · ${costClass.replaceAll("_", " ")}`;
}
