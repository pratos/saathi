import { start, vResultValidator, vWorkflowId, WorkflowManager } from "@convex-dev/workflow";
import { z } from "zod";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { env, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { parsePublicDocument } from "./lib/firecrawlParse";
import { attachmentHint, extractPasswordHints, findDocumentUrls, inferDirection } from "./lib/inboxExtract";

const category = v.union(
  v.literal("bills"),
  v.literal("school"),
  v.literal("travel"),
  v.literal("subscriptions"),
  v.literal("home"),
  v.literal("receipts"),
  v.literal("bank"),
  v.literal("needs_review"),
);

const actionValidator = v.object({
  kind: v.string(),
  label: v.string(),
  detail: v.optional(v.string()),
  url: v.optional(v.string()),
});

const extractionSchema = z.object({
  category: z.enum(["bills", "school", "travel", "subscriptions", "home", "receipts", "bank", "needs_review"]),
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

const workflow = new WorkflowManager(components.workflow);

export const processInboxItem = workflow
  .define({ args: { inboxItemId: v.id("inboxItems") } })
  .handler(async (step, args): Promise<void> => {
    await step.runMutation(internal.inboxWorkflow.markProcessing, args, { inline: true });
    const documents = await step.runAction(internal.inboxWorkflow.parseDocuments, args, { retry: true });
    const extraction = await step.runAction(internal.inboxWorkflow.extract, { ...args, documentMarkdown: documents.markdown }, { retry: true });
    await step.runMutation(internal.inboxWorkflow.applyExtraction, {
      ...args,
      ...extraction,
      documentParseStatus: documents.status,
      processingNotes: documents.notes || extraction.notes,
    }, { inline: true });
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
  }),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.inboxItemId);
    if (!item) throw new Error("Inbox item no longer exists");
    const space = await ctx.db.get(item.spaceId);
    return {
      subject: item.subject,
      originalText: item.originalText,
      originalHtml: item.originalHtml ?? null,
      sender: item.sender,
      familyInboxId: space?.agentmailInboxId ?? null,
    };
  },
});

export const parseDocuments = internalAction({
  args: { inboxItemId: v.id("inboxItems") },
  returns: v.object({
    markdown: v.string(),
    status: v.union(v.literal("none"), v.literal("parsed"), v.literal("password"), v.literal("failed")),
    notes: v.string(),
  }),
  handler: async (ctx, args): Promise<{ markdown: string; status: "none" | "parsed" | "password" | "failed"; notes: string }> => {
    const item: {
      subject: string;
      originalText: string;
      originalHtml: string | null;
      sender: string;
      familyInboxId: string | null;
    } = await ctx.runQuery(internal.inboxWorkflow.itemForExtraction, args);
    const urls = findDocumentUrls(item.originalHtml ?? "", item.originalText);
    if (urls.length === 0) {
      return {
        markdown: "",
        status: "none" as const,
        notes: attachmentHint(item.originalHtml ?? "", item.originalText, item.subject)
          ? "This email mentions a PDF or invoice, but no public document link was available to parse."
          : "",
      };
    }
    const apiKey = env.FIRECRAWL_API_KEY;
    if (!apiKey) return { markdown: "", status: "failed" as const, notes: "Document parsing needs FIRECRAWL_API_KEY." };
    const parsed: string[] = [];
    let passwordProtected = false;
    let failed = false;
    for (const url of urls) {
      const result = await parsePublicDocument(apiKey, url);
      if (result.markdown) parsed.push(result.markdown);
      else if (result.passwordProtected) passwordProtected = true;
      else failed = true;
    }
    if (parsed.length > 0) return { markdown: parsed.join("\n\n").slice(0, 40_000), status: "parsed" as const, notes: "" };
    if (passwordProtected) {
      const hint = extractPasswordHints(item.subject, item.originalText);
      return {
        markdown: "",
        status: "password" as const,
        notes: hint ?? "A PDF looks password-protected. Check the email for the invoice, policy, or account number.",
      };
    }
    return { markdown: "", status: failed ? "failed" as const : "none" as const, notes: failed ? "Saathi could not read an attached document." : "" };
  },
});

export const extract = internalAction({
  args: { inboxItemId: v.id("inboxItems"), documentMarkdown: v.optional(v.string()) },
  returns: v.object({
    category,
    amount: v.union(v.string(), v.null()),
    amountInr: v.union(v.string(), v.null()),
    amountUsd: v.union(v.string(), v.null()),
    dueAt: v.union(v.number(), v.null()),
    merchant: v.union(v.string(), v.null()),
    period: v.union(v.string(), v.null()),
    direction: v.union(v.literal("incoming"), v.literal("outgoing")),
    notes: v.union(v.string(), v.null()),
    actions: v.array(actionValidator),
  }),
  handler: async (ctx, args) => {
    const item = await ctx.runQuery(internal.inboxWorkflow.itemForExtraction, args);
    const fallbackDirection = inferDirection(item.sender, item.familyInboxId ?? undefined, item.originalText);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        category: "needs_review" as const,
        amount: null,
        amountInr: null,
        amountUsd: null,
        dueAt: null,
        merchant: null,
        period: null,
        direction: fallbackDirection,
        notes: args.documentMarkdown ? "Parsed an attached document without an extraction model." : null,
        actions: [],
      };
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_EXTRACTION_MODEL ?? "gpt-5-mini",
        input: [
          {
            role: "system",
            content: "Classify this household email. Subscriptions, tax invoices, and software receipts are purchases. Extract the exact paid amount in INR and USD when stated (amountInr, amountUsd), plus merchant and billing period. direction is incoming unless the family clearly sent money. Suggest confirmable household actions such as unsubscribe, pay_bill, or review_statement. Never invent URLs. dueAt must be a Unix timestamp in milliseconds or null.",
          },
          {
            role: "user",
            content: `Subject: ${item.subject}\nFrom: ${item.sender}\n\n${item.originalText.slice(0, 16_000)}\n\nDocument:\n${(args.documentMarkdown ?? "").slice(0, 12_000)}`,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "household_email_extraction",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["category", "amount", "amountInr", "amountUsd", "dueAt", "merchant", "period", "direction", "notes", "actions"],
              properties: {
                category: { type: "string", enum: ["bills", "school", "travel", "subscriptions", "home", "receipts", "bank", "needs_review"] },
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
            },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI extraction failed with status ${response.status}`);
    const payload = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const text = payload.output?.flatMap(output => output.content ?? []).find(content => content.type === "output_text")?.text;
    if (!text) throw new Error("OpenAI extraction returned no text output");
    const parsed = extractionSchema.parse(JSON.parse(text));
    return {
      ...parsed,
      direction: parsed.direction || fallbackDirection,
      actions: parsed.actions.slice(0, 4).map(action => ({
        kind: action.kind.slice(0, 40),
        label: action.label.slice(0, 80),
        detail: action.detail?.slice(0, 240) || undefined,
        url: action.url && action.url.startsWith("https://") ? action.url.slice(0, 500) : undefined,
      })),
    };
  },
});

export const applyExtraction = internalMutation({
  args: {
    inboxItemId: v.id("inboxItems"),
    category,
    amount: v.union(v.string(), v.null()),
    amountInr: v.union(v.string(), v.null()),
    amountUsd: v.union(v.string(), v.null()),
    dueAt: v.union(v.number(), v.null()),
    merchant: v.union(v.string(), v.null()),
    period: v.union(v.string(), v.null()),
    direction: v.union(v.literal("incoming"), v.literal("outgoing")),
    notes: v.union(v.string(), v.null()),
    actions: v.array(actionValidator),
    documentParseStatus: v.optional(v.union(v.literal("none"), v.literal("parsed"), v.literal("password"), v.literal("failed"))),
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
      extractedAmount: args.amount ?? args.amountInr ?? args.amountUsd ?? undefined,
      extractedAmountInr: args.amountInr ?? undefined,
      extractedAmountUsd: args.amountUsd ?? undefined,
      extractedDueAt: args.dueAt ?? undefined,
      extractedMerchant: args.merchant ?? undefined,
      extractedPeriod: args.period ?? undefined,
      direction: args.direction,
      processingNotes: notes,
      documentParseStatus: args.documentParseStatus ?? "none",
      suggestedActions: suggestedActions.length ? suggestedActions : undefined,
      actionStatus: suggestedActions.length ? "suggested" : undefined,
      heartbeatMessageId,
      status: "ready",
    });
    const userId = item.privateOwnerId ?? space?.createdBy;
    if (userId) {
      await ctx.db.insert("usageLedger", {
        spaceId: item.spaceId,
        userId,
        provider: "openai",
        model: process.env.OPENAI_EXTRACTION_MODEL ?? "gpt-5-mini",
        unit: "request",
        quantity: 1,
        costClass: "email_extraction",
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
