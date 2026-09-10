import { vResultValidator, vWorkflowId, WorkflowManager } from "@convex-dev/workflow";
import { z } from "zod";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";

const category = v.union(
  v.literal("bills"),
  v.literal("school"),
  v.literal("travel"),
  v.literal("subscriptions"),
  v.literal("home"),
  v.literal("receipts"),
  v.literal("needs_review"),
);

const extractionSchema = z.object({
  category: z.enum(["bills", "school", "travel", "subscriptions", "home", "receipts", "needs_review"]),
  amount: z.string().nullable(),
  dueAt: z.number().int().positive().nullable(),
});

const workflow = new WorkflowManager(components.workflow);

export const processInboxItem = workflow
  .define({ args: { inboxItemId: v.id("inboxItems") } })
  .handler(async (step, args): Promise<void> => {
    await step.runMutation(internal.inboxWorkflow.markProcessing, args, { inline: true });
    const extraction = await step.runAction(internal.inboxWorkflow.extract, args, { retry: true });
    await step.runMutation(internal.inboxWorkflow.applyExtraction, { ...args, ...extraction }, { inline: true });
  });

export const markProcessing = internalMutation({
  args: { inboxItemId: v.id("inboxItems") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.inboxItemId);
    if (item && item.status === "received") await ctx.db.patch(item._id, { status: "processing" });
  },
});

export const itemForExtraction = internalQuery({
  args: { inboxItemId: v.id("inboxItems") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.inboxItemId);
    if (!item) throw new Error("Inbox item no longer exists");
    return { subject: item.subject, originalText: item.originalText };
  },
});

export const extract = internalAction({
  args: { inboxItemId: v.id("inboxItems") },
  returns: v.object({ category, amount: v.union(v.string(), v.null()), dueAt: v.union(v.number(), v.null()) }),
  handler: async (ctx, args): Promise<z.infer<typeof extractionSchema>> => {
    const item = await ctx.runQuery(internal.inboxWorkflow.itemForExtraction, args);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_EXTRACTION_MODEL ?? "gpt-5-mini",
        input: [
          { role: "system", content: "Classify this household email and extract only an explicitly stated amount and due date. Use needs_review when uncertain. dueAt must be a Unix timestamp in milliseconds or null." },
          { role: "user", content: `Subject: ${item.subject}\n\n${item.originalText.slice(0, 20_000)}` },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "household_email_extraction",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["category", "amount", "dueAt"],
              properties: {
                category: { type: "string", enum: ["bills", "school", "travel", "subscriptions", "home", "receipts", "needs_review"] },
                amount: { type: ["string", "null"] },
                dueAt: { type: ["integer", "null"] },
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
    return extractionSchema.parse(JSON.parse(text));
  },
});

export const applyExtraction = internalMutation({
  args: {
    inboxItemId: v.id("inboxItems"), category,
    amount: v.union(v.string(), v.null()), dueAt: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.inboxItemId);
    if (!item) return;
    const space = await ctx.db.get(item.spaceId);
    await ctx.db.patch(item._id, {
      category: args.category,
      extractedAmount: args.amount ?? undefined,
      extractedDueAt: args.dueAt ?? undefined,
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
  },
});

export const handleComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ inboxItemId: v.id("inboxItems") }),
  },
  handler: async (ctx, args) => {
    if (args.result.kind === "success") return;
    const item = await ctx.db.get(args.context.inboxItemId);
    if (!item || item.status === "ready") return;
    await ctx.db.patch(item._id, { status: "failed" });
    await ctx.db.insert("auditEvents", {
      spaceId: item.spaceId,
      action: "inbox.processing_failed",
      resourceType: "inboxItem",
      resourceId: String(item._id),
      metadata: { workflowId: args.workflowId, outcome: args.result.kind },
      createdAt: Date.now(),
    });
  },
});
