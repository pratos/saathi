import { start, vResultValidator, vWorkflowId, WorkflowManager } from "@convex-dev/workflow";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireSpacePermission } from "./lib/authz";

const BATCH_SIZE = 5;
const ITEM_INTERVAL_MS = 250;
const workflow = new WorkflowManager(components.workflow);

const category = v.union(
  v.literal("bills"), v.literal("school"), v.literal("travel"), v.literal("appointments"),
  v.literal("subscriptions"), v.literal("home"), v.literal("receipts"), v.literal("bank"),
  v.literal("security"), v.literal("needs_review"),
);

const subcategory = v.union(
  v.literal("utility_bill"), v.literal("credit_card_bill"), v.literal("loan_payment"),
  v.literal("insurance_premium"), v.literal("tax_payment"), v.literal("rent"),
  v.literal("medical_bill"), v.literal("school_fee"), v.literal("purchase_receipt"),
  v.literal("food_delivery"), v.literal("refund"), v.literal("warranty"),
  v.literal("bank_transaction"), v.literal("bank_statement"), v.literal("credit_card_statement"),
  v.literal("investment"), v.literal("demat"), v.literal("otp"), v.literal("login_code"),
  v.literal("sign_in_alert"), v.literal("password_reset"), v.literal("field_trip"),
  v.literal("school_event"), v.literal("permission_form"), v.literal("report_card"),
  v.literal("timetable"), v.literal("school_transport"), v.literal("flight"),
  v.literal("train"), v.literal("bus"), v.literal("hotel"), v.literal("visa"),
  v.literal("itinerary"), v.literal("booking_change"), v.literal("medical_appointment"),
  v.literal("service_appointment"), v.literal("government_appointment"), v.literal("reservation"),
  v.literal("subscription_renewal"), v.literal("subscription_price_change"),
  v.literal("trial_ending"), v.literal("subscription_cancellation"),
  v.literal("home_maintenance"), v.literal("delivery"), v.literal("community_notice"),
  v.literal("household_service"), v.literal("other"),
);

const extractionArgs = {
  category,
  subcategory,
  amount: v.union(v.string(), v.null()),
  amountInr: v.union(v.string(), v.null()),
  amountUsd: v.union(v.string(), v.null()),
  dueAt: v.union(v.number(), v.null()),
  merchant: v.union(v.string(), v.null()),
  period: v.union(v.string(), v.null()),
  direction: v.union(v.literal("incoming"), v.literal("outgoing")),
};

const jobStatus = v.union(v.literal("queued"), v.literal("running"), v.literal("complete"), v.literal("failed"));

export const startForSpace = mutation({
  args: { spaceId: v.id("spaces") },
  returns: v.id("inboxRecategorizationJobs"),
  handler: async (ctx, args) => {
    const { userId } = await requireSpacePermission(ctx, args.spaceId, "configure_inbox");
    const active = await ctx.db.query("inboxRecategorizationJobs")
      .withIndex("by_space_status", q => q.eq("spaceId", args.spaceId).eq("status", "queued"))
      .unique()
      ?? await ctx.db.query("inboxRecategorizationJobs")
        .withIndex("by_space_status", q => q.eq("spaceId", args.spaceId).eq("status", "running"))
        .unique();
    if (active) return active._id;

    const now = Date.now();
    const jobId = await ctx.db.insert("inboxRecategorizationJobs", {
      spaceId: args.spaceId,
      createdBy: userId,
      startedAt: now,
      updatedAt: now,
      status: "queued",
      discovered: 0,
      recategorized: 0,
      skipped: 0,
      scanComplete: false,
    });
    await ctx.scheduler.runAfter(0, internal.recategorization.begin, { jobId });
    return jobId;
  },
});

export const status = query({
  args: { jobId: v.id("inboxRecategorizationJobs") },
  returns: v.object({
    jobId: v.id("inboxRecategorizationJobs"),
    spaceId: v.id("spaces"),
    status: jobStatus,
    startedAt: v.number(),
    updatedAt: v.number(),
    discovered: v.number(),
    total: v.union(v.number(), v.null()),
    recategorized: v.number(),
    skipped: v.number(),
    currentBatchSize: v.number(),
    error: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new ConvexError({ code: "NOT_FOUND", message: "Recategorization job not found" });
    await requireSpacePermission(ctx, job.spaceId, "configure_inbox");
    return {
      jobId: job._id,
      spaceId: job.spaceId,
      status: job.status,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      discovered: job.discovered,
      total: job.scanComplete ? job.discovered : null,
      recategorized: job.recategorized,
      skipped: job.skipped,
      currentBatchSize: job.currentBatch?.length ?? 0,
      error: job.error ?? null,
    };
  },
});

export const latestForSpace = query({
  args: { spaceId: v.id("spaces") },
  returns: v.union(v.object({
    jobId: v.id("inboxRecategorizationJobs"),
    status: jobStatus,
    startedAt: v.number(),
    updatedAt: v.number(),
    discovered: v.number(),
    total: v.union(v.number(), v.null()),
    recategorized: v.number(),
    skipped: v.number(),
    error: v.union(v.string(), v.null()),
  }), v.null()),
  handler: async (ctx, { spaceId }) => {
    await requireSpacePermission(ctx, spaceId, "configure_inbox");
    const job = await ctx.db.query("inboxRecategorizationJobs")
      .withIndex("by_space_started_at", q => q.eq("spaceId", spaceId))
      .order("desc")
      .first();
    if (!job) return null;
    return {
      jobId: job._id,
      status: job.status,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      discovered: job.discovered,
      total: job.scanComplete ? job.discovered : null,
      recategorized: job.recategorized,
      skipped: job.skipped,
      error: job.error ?? null,
    };
  },
});

export const resume = mutation({
  args: { jobId: v.id("inboxRecategorizationJobs") },
  returns: v.id("inboxRecategorizationJobs"),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new ConvexError({ code: "NOT_FOUND", message: "Recategorization job not found" });
    await requireSpacePermission(ctx, job.spaceId, "configure_inbox");
    if (job.status !== "failed") return job._id;
    await ctx.db.patch(job._id, { status: "queued", workflowId: undefined, error: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.recategorization.begin, { jobId: job._id });
    return job._id;
  },
});

export const begin = internalMutation({
  args: { jobId: v.id("inboxRecategorizationJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "queued" || job.workflowId) return null;
    const workflowId = await start(ctx, internal.recategorization.process, args, {
      onComplete: internal.recategorization.handleComplete,
      context: args,
    });
    await ctx.db.patch(job._id, { status: "running", workflowId: String(workflowId), updatedAt: Date.now() });
    return null;
  },
});

export const process = workflow
  .define({ args: { jobId: v.id("inboxRecategorizationJobs") } })
  .handler(async (step, args): Promise<void> => {
    while (true) {
      const batch = await step.runMutation(internal.recategorization.claimNextBatch, args, { inline: true });
      if (batch.complete) return;
      for (const inboxItemId of batch.inboxItemIds) {
        const eligible = await step.runMutation(
          internal.recategorization.checkEligibility,
          { ...args, inboxItemId },
          { inline: true },
        );
        if (!eligible) {
          await step.runMutation(
            internal.recategorization.recordOutcome,
            { ...args, inboxItemId, outcome: "skipped" },
            { inline: true },
          );
          continue;
        }
        const documents = await step.runAction(internal.inboxWorkflow.parseDocuments, { inboxItemId }, { retry: false });
        const extraction = await step.runAction(
          internal.inboxWorkflow.extract,
          { inboxItemId, documentMarkdown: documents.markdown },
          { retry: { maxAttempts: 2, initialBackoffMs: 1_000, base: 2 } },
        );
        const outcome = await step.runMutation(internal.recategorization.applyExtraction, {
          ...args,
          inboxItemId,
          category: extraction.category,
          subcategory: extraction.subcategory,
          amount: extraction.amount,
          amountInr: extraction.amountInr,
          amountUsd: extraction.amountUsd,
          dueAt: extraction.dueAt,
          merchant: extraction.merchant,
          period: extraction.period,
          direction: extraction.direction,
        }, { inline: true });
        await step.runMutation(internal.recategorization.recordOutcome, { ...args, inboxItemId, outcome }, { inline: true });
        await step.sleep(ITEM_INTERVAL_MS);
      }
      await step.runMutation(internal.recategorization.finishCurrentBatch, args, { inline: true });
    }
  });

export const claimNextBatch = internalMutation({
  args: { jobId: v.id("inboxRecategorizationJobs") },
  returns: v.object({ inboxItemIds: v.array(v.id("inboxItems")), complete: v.boolean() }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Recategorization job no longer exists");
    if (job.status === "complete") return { inboxItemIds: [], complete: true };
    if (job.status !== "running") throw new Error("Recategorization job is not running");

    if (job.currentBatch) {
      const completed = new Set(job.currentBatchCompleted ?? []);
      return { inboxItemIds: job.currentBatch.filter(id => !completed.has(id)), complete: false };
    }

    if (job.scanComplete) {
      await ctx.db.patch(job._id, { status: "complete", updatedAt: Date.now() });
      return { inboxItemIds: [], complete: true };
    }

    const page = await ctx.db.query("inboxItems")
      .withIndex("by_space_received", q => q.eq("spaceId", job.spaceId))
      .order("asc")
      .paginate({ numItems: BATCH_SIZE, cursor: job.scanCursor ?? null });
    if (page.page.length === 0) {
      await ctx.db.patch(job._id, { scanComplete: true, status: "complete", updatedAt: Date.now() });
      return { inboxItemIds: [], complete: true };
    }
    const inboxItemIds = page.page.map(item => item._id);
    await ctx.db.patch(job._id, {
      currentBatch: inboxItemIds,
      currentBatchCompleted: [],
      currentBatchIsFinal: page.isDone,
      pendingCursor: page.continueCursor,
      discovered: job.discovered + inboxItemIds.length,
      updatedAt: Date.now(),
    });
    return { inboxItemIds, complete: false };
  },
});

export const checkEligibility = internalMutation({
  args: { jobId: v.id("inboxRecategorizationJobs"), inboxItemId: v.id("inboxItems") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const [job, item] = await Promise.all([ctx.db.get(args.jobId), ctx.db.get(args.inboxItemId)]);
    if (!job || !job.currentBatch?.includes(args.inboxItemId)) {
      throw new Error("Inbox item is not in this recategorization batch");
    }
    return item !== null
      && item.spaceId === job.spaceId
      && item.category !== "security"
      && !isReviewedAfterRecategorizationStarted(item, job.startedAt);
  },
});

export const applyExtraction = internalMutation({
  args: { jobId: v.id("inboxRecategorizationJobs"), inboxItemId: v.id("inboxItems"), ...extractionArgs },
  returns: v.union(v.literal("recategorized"), v.literal("skipped")),
  handler: async (ctx, args) => {
    const [job, item] = await Promise.all([ctx.db.get(args.jobId), ctx.db.get(args.inboxItemId)]);
    if (!job) throw new Error("Recategorization job no longer exists");
    if (!item || item.spaceId !== job.spaceId || !job.currentBatch?.includes(args.inboxItemId)) {
      throw new Error("Inbox item is not in this recategorization batch");
    }
    if (isReviewedAfterRecategorizationStarted(item, job.startedAt)) return "skipped";

    // Deliberately only update machine-extracted taxonomy fields. Human action
    // decisions, suggestions, heartbeat, status, and parse notes are retained.
    await ctx.db.patch(item._id, {
      category: args.category,
      subcategory: args.subcategory,
      extractedAmount: args.amount ?? args.amountInr ?? args.amountUsd ?? undefined,
      extractedAmountInr: args.amountInr ?? undefined,
      extractedAmountUsd: args.amountUsd ?? undefined,
      extractedDueAt: args.dueAt ?? undefined,
      extractedMerchant: args.merchant ?? undefined,
      extractedPeriod: args.period ?? undefined,
      direction: args.direction,
    });
    return "recategorized";
  },
});

export const recordOutcome = internalMutation({
  args: {
    jobId: v.id("inboxRecategorizationJobs"),
    inboxItemId: v.id("inboxItems"),
    outcome: v.union(v.literal("recategorized"), v.literal("skipped")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || !job.currentBatch?.includes(args.inboxItemId)) throw new Error("Inbox item is not in this recategorization batch");
    const completed = job.currentBatchCompleted ?? [];
    if (completed.includes(args.inboxItemId)) return null;
    await ctx.db.patch(job._id, {
      currentBatchCompleted: [...completed, args.inboxItemId],
      recategorized: job.recategorized + (args.outcome === "recategorized" ? 1 : 0),
      skipped: job.skipped + (args.outcome === "skipped" ? 1 : 0),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const finishCurrentBatch = internalMutation({
  args: { jobId: v.id("inboxRecategorizationJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Recategorization job no longer exists");
    if (!job.currentBatch) return null;
    if ((job.currentBatchCompleted?.length ?? 0) !== job.currentBatch.length) {
      throw new Error("Cannot finish a partially processed recategorization batch");
    }
    const complete = job.currentBatchIsFinal === true;
    await ctx.db.patch(job._id, {
      scanCursor: job.pendingCursor,
      pendingCursor: undefined,
      currentBatch: undefined,
      currentBatchCompleted: undefined,
      currentBatchIsFinal: undefined,
      scanComplete: complete || job.scanComplete,
      status: complete ? "complete" : "running",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const handleComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ jobId: v.id("inboxRecategorizationJobs") }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.context.jobId);
    if (!job || job.workflowId !== String(args.workflowId) || args.result.kind === "success") return null;
    await ctx.db.patch(job._id, {
      status: "failed",
      error: args.result.kind === "failed" ? args.result.error.slice(0, 500) : "Workflow canceled",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export function isReviewedAfterRecategorizationStarted(
  item: { actionStatus?: "suggested" | "confirmed" | "dismissed"; reviewedAt?: number },
  startedAt: number,
) {
  return item.actionStatus === "confirmed"
    || item.actionStatus === "dismissed"
    || (item.reviewedAt !== undefined && item.reviewedAt > startedAt);
}
