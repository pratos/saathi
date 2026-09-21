import { z } from "zod";
import { start } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const inboundMessage = z.object({
  inbox_id: z.string().min(1),
  thread_id: z.string().min(1),
  message_id: z.string().min(1),
  from: z.string().min(1),
  subject: z.string().optional(),
  preview: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  extracted_text: z.string().optional(),
  extracted_html: z.string().optional(),
  timestamp: z.string(),
});

type InboundMessage = z.infer<typeof inboundMessage>;

export function inboundMessageBodies(message: InboundMessage) {
  return {
    text: message.extracted_text ?? message.text ?? message.preview ?? "",
    html: message.extracted_html ?? message.html,
  };
}

export const onMessageReceived = internalMutation({
  args: { message: v.any(), thread: v.any(), eventId: v.string() },
  handler: async (ctx, args) => {
    const parsed = inboundMessage.safeParse(args.message);
    if (!parsed.success) {
      throw new Error(`AgentMail message ${args.eventId} did not match the expected inbound contract`);
    }
    const message = parsed.data;
    const space = await ctx.db.query("spaces").withIndex("by_agentmail_inbox", q => q.eq("agentmailInboxId", message.inbox_id)).unique();
    if (!space) return;

    const existing = await ctx.db.query("inboxItems").withIndex("by_agentmail_message", q => q.eq("agentmailMessageId", message.message_id)).unique();
    if (existing) return existing._id;

    const timestamp = Date.parse(message.timestamp);
    const bodies = inboundMessageBodies(message);
    const inboxItemId = await ctx.db.insert("inboxItems", {
      spaceId: space._id,
      agentmailMessageId: message.message_id,
      agentmailThreadId: message.thread_id,
      sender: message.from,
      subject: message.subject?.trim() || "No subject",
      originalText: bodies.text,
      originalHtml: bodies.html,
      visibility: "space",
      category: "needs_review",
      status: "received",
      receivedAt: Number.isFinite(timestamp) ? timestamp : Date.now(),
    });
    await ctx.db.insert("auditEvents", {
      spaceId: space._id,
      action: "inbox.received",
      resourceType: "inboxItem",
      resourceId: String(inboxItemId),
      metadata: { eventId: args.eventId, sender: message.from },
      createdAt: Date.now(),
    });
    await start(
      ctx,
      internal.inboxWorkflow.processInboxItem,
      { inboxItemId },
      {
        onComplete: internal.inboxWorkflow.handleComplete,
        context: { inboxItemId },
      },
    );
    return inboxItemId;
  },
});
