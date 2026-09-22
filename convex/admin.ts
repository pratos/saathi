import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
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

function usageServiceLabel(costClass: string, model: string | undefined, provider: string) {
  if (costClass === "voice") return "GPT-Live 1 · voice session";
  if (costClass === "voice_backend") return "GPT-5.6 Luna · delegated voice work";
  if (costClass === "voice_summary") return "GPT-5.6 Luna · post-call summary";
  if (costClass === "voice_backend_tool") return "OpenAI web search · delegated voice tool";
  if (costClass === "chat") return `${model ?? "Text model"} · chat`;
  if (costClass === "email_extraction") return `${model ?? "Text model"} · email extraction`;
  return `${model ?? provider} · ${costClass.replaceAll("_", " ")}`;
}
