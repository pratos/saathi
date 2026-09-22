import { start, vResultValidator, vWorkflowId, WorkflowManager } from "@convex-dev/workflow";
import { z } from "zod";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { parsePublicDocument } from "./lib/firecrawlParse";
import { attachmentHint, extractPasswordHints, findDocumentUrls, inferDirection } from "./lib/inboxExtract";
import { INBOX_CATEGORY_IDS, INBOX_SUBCATEGORY_IDS } from "./lib/emailTaxonomy";
import {
  classifyInboxEmail,
  inboxClassificationResultValidator,
  type InboxClassificationResult,
} from "./lib/inboxClassification";
import { runOpenRouterDecision, type OpenRouterDecisionResult } from "./lib/decisionProvider";
import { MODEL_TIERS } from "./lib/modelTiers";
import { resolveOpenRouterCredential, resolveOptionalDecisionCredential } from "./lib/providerKeys";

const category = v.union(
  v.literal("bills"),
  v.literal("school"),
  v.literal("travel"),
  v.literal("appointments"),
  v.literal("subscriptions"),
  v.literal("home"),
  v.literal("receipts"),
  v.literal("bank"),
  v.literal("security"),
  v.literal("needs_review"),
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
  v.literal("subscription_renewal"), v.literal("subscription_price_change"), v.literal("trial_ending"),
  v.literal("subscription_cancellation"), v.literal("home_maintenance"), v.literal("delivery"),
  v.literal("community_notice"), v.literal("household_service"), v.literal("other"),
);

const actionValidator = v.object({
  kind: v.string(),
  label: v.string(),
  detail: v.optional(v.string()),
  url: v.optional(v.string()),
});

const extractionSchema = z.object({
  category: z.enum(INBOX_CATEGORY_IDS),
  subcategory: z.enum(INBOX_SUBCATEGORY_IDS),
  amount: z.string().nullable(),
  amountInr: z.string().nullable(),
  amountUsd: z.string().nullable(),
  dueAt: z.number().int().positive().nullable(),
  merchant: z.string().nullable(),
  period: z.string().nullable(),
  direction: z.enum(["incoming", "outgoing"]),
  notes: z.string().nullable(),
  actions: z.array(z.object({
    kind: z.string(),
    label: z.string(),
    detail: z.string().nullable(),
    url: z.string().nullable(),
  })),
});

type InboxExtraction = {
  category: z.infer<typeof extractionSchema>["category"];
  subcategory: z.infer<typeof extractionSchema>["subcategory"];
  amount: string | null;
  amountInr: string | null;
  amountUsd: string | null;
  dueAt: number | null;
  merchant: string | null;
  period: string | null;
  direction: "incoming" | "outgoing";
  notes: string | null;
  actions: Array<{ kind: string; label: string; detail?: string; url?: string }>;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
};

const extractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["category", "subcategory", "amount", "amountInr", "amountUsd", "dueAt", "merchant", "period", "direction", "notes", "actions"],
  properties: {
    category: { type: "string", enum: INBOX_CATEGORY_IDS },
    subcategory: { type: "string", enum: INBOX_SUBCATEGORY_IDS },
    amount: { type: ["string", "null"] },
    amountInr: { type: ["string", "null"] },
    amountUsd: { type: ["string", "null"] },
    dueAt: { type: ["integer", "null"] },
    merchant: { type: ["string", "null"] },
    period: { type: ["string", "null"] },
    direction: { type: "string", enum: ["incoming", "outgoing"] },
    notes: { type: ["string", "null"] },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "label", "detail", "url"],
        properties: {
          kind: { type: "string" },
          label: { type: "string" },
          detail: { type: ["string", "null"] },
          url: { type: ["string", "null"] },
        },
      },
    },
  },
} satisfies Record<string, unknown>;

const workflow = new WorkflowManager(components.workflow);

export const processInboxItem = workflow
  .define({ args: { inboxItemId: v.id("inboxItems") } })
  .handler(async (step, args): Promise<void> => {
    await step.runMutation(internal.inboxWorkflow.markProcessing, args, { inline: true });
    const documents = await step.runAction(internal.inboxWorkflow.parseDocuments, args, { retry: false });
    const extraction = await step.runAction(
      internal.inboxWorkflow.extract,
      { ...args, documentMarkdown: documents.markdown },
      { retry: { maxAttempts: 2, initialBackoffMs: 1_000, base: 2 } },
    );
    await step.runMutation(internal.inboxWorkflow.applyExtraction, {
      ...args,
      ...extraction,
      documentParseStatus: documents.status,
      documentParseRetryable: documents.retryable,
      processingNotes: documents.notes || extraction.notes,
    }, { inline: true });
    const claimed = await step.runMutation(internal.jev.claimInboxClassification, args, { inline: true });
    if (claimed) {
      const classification = await step.runAction(internal.inboxWorkflow.classifyForTelemetry, args);
      await step.runMutation(internal.jev.completeInboxClassification, { ...args, result: classification }, { inline: true });
    }
  });

export const enqueue = internalMutation({
  args: { inboxItemId: v.id("inboxItems") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await start(ctx, internal.inboxWorkflow.processInboxItem, args, {
      onComplete: internal.inboxWorkflow.handleComplete,
      context: args,
    });
    return null;
  },
});

export const markProcessing = internalMutation({
  args: { inboxItemId: v.id("inboxItems") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.inboxItemId);
    if (item && item.status === "received") await ctx.db.patch(item._id, { status: "processing" });
    return null;
  },
});

export const itemForExtraction = internalQuery({
  args: { inboxItemId: v.id("inboxItems") },
  returns: v.object({
    subject: v.string(),
    originalText: v.string(),
    originalHtml: v.union(v.string(), v.null()),
    sender: v.string(),
    familyInboxId: v.union(v.string(), v.null()),
    agentmailMessageId: v.string(),
    spaceId: v.id("spaces"),
    credentialUserId: v.id("users"),
  }),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.inboxItemId);
    if (!item) throw new Error("Inbox item no longer exists");
    const space = await ctx.db.get(item.spaceId);
    if (!space) throw new Error("Family space no longer exists");
    return {
      subject: item.subject,
      originalText: item.originalText,
      originalHtml: item.originalHtml ?? null,
      sender: item.sender,
      familyInboxId: space.agentmailInboxId ?? null,
      agentmailMessageId: item.agentmailMessageId,
      spaceId: item.spaceId,
      credentialUserId: space.createdBy,
    };
  },
});

export const classifyForTelemetry = internalAction({
  args: { inboxItemId: v.id("inboxItems") },
  returns: inboxClassificationResultValidator,
  handler: async (ctx, args): Promise<InboxClassificationResult> => {
    const item: {
      subject: string;
      originalText: string;
      originalHtml: string | null;
      sender: string;
      familyInboxId: string | null;
      agentmailMessageId: string;
      spaceId: Id<"spaces">;
      credentialUserId: Id<"users">;
    } = await ctx.runQuery(internal.inboxWorkflow.itemForExtraction, args);
    const credential = await resolveOptionalDecisionCredential(ctx, item.spaceId, item.credentialUserId);
    return await classifyInboxEmail(credential ?? undefined, {
      sender: item.sender,
      subject: item.subject,
      text: item.originalText,
    });
  },
});

export const parseDocuments = internalAction({
  args: { inboxItemId: v.id("inboxItems") },
  returns: v.object({
    markdown: v.string(),
    status: v.union(v.literal("none"), v.literal("parsed"), v.literal("password"), v.literal("failed")),
    notes: v.string(),
    retryable: v.boolean(),
  }),
  handler: async (ctx, args): Promise<{
    markdown: string;
    status: "none" | "parsed" | "password" | "failed";
    notes: string;
    retryable: boolean;
  }> => {
    const item: {
      subject: string;
      originalText: string;
      originalHtml: string | null;
      sender: string;
      familyInboxId: string | null;
      agentmailMessageId: string;
    } = await ctx.runQuery(internal.inboxWorkflow.itemForExtraction, args);
    const urls = findDocumentUrls(item.originalHtml ?? "", item.originalText);
    if (urls.length === 0) {
      if (item.agentmailMessageId.startsWith("gmail:")) {
        const gmailResult: {
          markdown: string;
          status: "none" | "parsed" | "password" | "failed";
          notes: string;
          retryable: boolean;
        } = await ctx.runAction(internal.gmail.readInboxAttachments, args);
        if (gmailResult.status !== "none" || gmailResult.notes) return gmailResult;
      }
      return {
        markdown: "",
        status: "none" as const,
        notes: attachmentHint(item.originalHtml ?? "", item.originalText, item.subject)
          ? "This email mentions a PDF or invoice, but no public document link was available to parse."
          : "",
        retryable: false,
      };
    }
    const apiKey = env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      return {
        markdown: "",
        status: "failed" as const,
        notes: "PDF reading is not configured. Ask an administrator to add FIRECRAWL_API_KEY.",
        retryable: false,
      };
    }
    const parsed: string[] = [];
    const failures: string[] = [];
    let passwordProtected = false;
    let failed = false;
    let retryable = false;
    for (const url of urls) {
      const result = await parsePublicDocument(apiKey, url);
      if (result.markdown) parsed.push(result.markdown);
      else if (result.passwordProtected) passwordProtected = true;
      else {
        failed = true;
        retryable ||= result.retryable;
        if (result.error) failures.push(result.error);
      }
    }
    if (parsed.length > 0) {
      return {
        markdown: parsed.join("\n\n").slice(0, 40_000),
        status: "parsed" as const,
        notes: "",
        retryable: false,
      };
    }
    if (passwordProtected) {
      const hint = extractPasswordHints(item.subject, item.originalText);
      return {
        markdown: "",
        status: "password" as const,
        notes: hint ?? "A PDF looks password-protected. Check the email for the invoice, policy, or account number.",
        retryable: false,
      };
    }
    return {
      markdown: "",
      status: failed ? "failed" as const : "none" as const,
      notes: failed ? failures[0] ?? "Saathi could not read an attached document." : "",
      retryable: failed && retryable,
    };
  },
});

export const extract = internalAction({
  args: { inboxItemId: v.id("inboxItems"), documentMarkdown: v.optional(v.string()) },
  returns: v.object({
    category,
    subcategory,
    amount: v.union(v.string(), v.null()),
    amountInr: v.union(v.string(), v.null()),
    amountUsd: v.union(v.string(), v.null()),
    dueAt: v.union(v.number(), v.null()),
    merchant: v.union(v.string(), v.null()),
    period: v.union(v.string(), v.null()),
    direction: v.union(v.literal("incoming"), v.literal("outgoing")),
    notes: v.union(v.string(), v.null()),
    actions: v.array(actionValidator),
    model: v.union(v.string(), v.null()),
    inputTokens: v.number(),
    outputTokens: v.number(),
  }),
  handler: async (ctx, args): Promise<InboxExtraction> => {
    const item: {
      subject: string;
      originalText: string;
      originalHtml: string | null;
      sender: string;
      familyInboxId: string | null;
      agentmailMessageId: string;
      spaceId: Id<"spaces">;
      credentialUserId: Id<"users">;
    } = await ctx.runQuery(internal.inboxWorkflow.itemForExtraction, args);
    const fallbackDirection = inferDirection(item.sender, item.familyInboxId ?? undefined, item.originalText);
    let apiKey = "";
    try {
      apiKey = (await resolveOpenRouterCredential(ctx, item.spaceId, item.credentialUserId)).apiKey;
    } catch {
      // Inbox ingestion remains useful without OpenRouter; document parsing and manual review still work.
    }
    if (!apiKey) {
      return {
        category: "needs_review" as const,
        subcategory: "other" as const,
        amount: null,
        amountInr: null,
        amountUsd: null,
        dueAt: null,
        merchant: null,
        period: null,
        direction: fallbackDirection,
        notes: args.documentMarkdown
          ? "Parsed an attached document, but Flash extraction is not available for this family."
          : "Flash extraction is not available for this family.",
        actions: [],
        model: null,
        inputTokens: 0,
        outputTokens: 0,
      };
    }

    const result: OpenRouterDecisionResult<unknown> = await runOpenRouterDecision<unknown>({
      kind: "byok_openrouter",
      apiKey,
      model: MODEL_TIERS.low.model,
    }, {
      name: "household_email_extraction",
      state: {
        subject: item.subject,
        sender: item.sender,
        email: item.originalText.slice(0, 16_000),
        document: (args.documentMarkdown ?? "").slice(0, 12_000),
      },
      instructions: "Classify this family email into a broad category and the most specific allowed subcategory. Extract exact amounts in INR and USD when stated (amountInr, amountUsd), due date, merchant or institution, billing or service period, direction, and up to four confirmable next steps. Use school/field_trip or school/school_fee for school trip notices as appropriate; security/otp, security/login_code, security/sign_in_alert, or security/password_reset for authentication mail; travel for bookings and itinerary changes; appointments for medical, service, government, and reservation reminders; and bank for transaction, statement, card, demat, investment, and loan notices. Never copy an OTP, login code, password-reset token, account number, or other credential into notes or actions. direction is incoming unless the family clearly sent money. Never invent URLs. dueAt must be a Unix timestamp in milliseconds or null.",
      schema: extractionJsonSchema,
    });
    const parsed = extractionSchema.parse(result.output);
    return {
      ...parsed,
      direction: parsed.direction || fallbackDirection,
      actions: parsed.actions.slice(0, 4).map(action => ({
        kind: action.kind.slice(0, 40),
        label: action.label.slice(0, 80),
        detail: action.detail?.slice(0, 240) || undefined,
        url: action.url && action.url.startsWith("https://") ? action.url.slice(0, 500) : undefined,
      })),
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  },
});

export const applyExtraction = internalMutation({
  args: {
    inboxItemId: v.id("inboxItems"),
    category,
    subcategory,
    amount: v.union(v.string(), v.null()),
    amountInr: v.union(v.string(), v.null()),
    amountUsd: v.union(v.string(), v.null()),
    dueAt: v.union(v.number(), v.null()),
    merchant: v.union(v.string(), v.null()),
    period: v.union(v.string(), v.null()),
    direction: v.union(v.literal("incoming"), v.literal("outgoing")),
    notes: v.union(v.string(), v.null()),
    actions: v.array(actionValidator),
    model: v.union(v.string(), v.null()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    documentParseStatus: v.optional(v.union(v.literal("none"), v.literal("parsed"), v.literal("password"), v.literal("failed"))),
    documentParseRetryable: v.optional(v.boolean()),
    processingNotes: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.inboxItemId);
    if (!item) return null;
    const space = await ctx.db.get(item.spaceId);
    const familyRoom = await ctx.db.query("rooms").withIndex("by_space", q => q.eq("spaceId", item.spaceId))
      .filter(q => q.eq(q.field("type"), "shared")).first();
    const suggestedActions = args.actions.filter(action => action.label.trim()).slice(0, 4).map(action => ({
      kind: action.kind || "review",
      label: action.label,
      detail: action.detail ?? undefined,
      url: action.url ?? undefined,
    }));
    const notes = [args.processingNotes, args.notes].filter(Boolean).join(" ").trim() || undefined;
    let heartbeatMessageId = item.heartbeatMessageId;
    if (item.visibility === "space" && familyRoom && !heartbeatMessageId) {
      heartbeatMessageId = await ctx.db.insert("messages", {
        spaceId: item.spaceId,
        roomId: familyRoom._id,
        actorType: "assistant",
        origin: "assistant",
        originalText: heartbeatText(item.subject, args.category, args.amount, args.direction, args.documentParseStatus),
        language: "en",
        idempotencyKey: `inbox-heartbeat:${item._id}`,
        createdAt: Date.now(),
      });
    }
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
      processingNotes: notes,
      documentParseStatus: args.documentParseStatus ?? "none",
      documentParseRetryable: args.documentParseRetryable,
      suggestedActions: suggestedActions.length ? suggestedActions : undefined,
      actionStatus: suggestedActions.length ? "suggested" : undefined,
      heartbeatMessageId,
      status: "ready",
    });
    const userId = item.privateOwnerId ?? space?.createdBy;
    if (userId && args.model) {
      await ctx.db.insert("usageLedger", {
        spaceId: item.spaceId,
        userId,
        provider: "openrouter",
        model: args.model,
        unit: "request",
        quantity: 1,
        costClass: "email_extraction",
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        createdAt: Date.now(),
      });
    }
    return null;
  },
});

export const handleComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ inboxItemId: v.id("inboxItems") }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.result.kind === "success") return null;
    const item = await ctx.db.get(args.context.inboxItemId);
    if (!item || item.status === "ready") return null;
    await ctx.db.patch(item._id, { status: "failed" });
    await ctx.db.insert("auditEvents", {
      spaceId: item.spaceId,
      action: "inbox.processing_failed",
      resourceType: "inboxItem",
      resourceId: String(item._id),
      metadata: { workflowId: args.workflowId, outcome: args.result.kind },
      createdAt: Date.now(),
    });
    return null;
  },
});

function heartbeatText(
  subject: string,
  category: string,
  amount: string | null,
  direction: "incoming" | "outgoing",
  documentStatus: string | undefined,
) {
  const money = amount ? ` Amount ${amount}.` : "";
  const docs = documentStatus === "parsed" ? " An attached document was read."
    : documentStatus === "password" ? " A password-protected PDF needs a hint from the email."
      : "";
  return `Family inbox update: reviewed “${subject}” (${direction} ${category}).${money}${docs} Open Family inbox to confirm any suggested action.`;
}
