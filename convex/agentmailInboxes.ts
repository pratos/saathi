import { AgentMail } from "@agentmail/convex";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import { action } from "./_generated/server";

const agentmail = new AgentMail(components.agentmail);

export const createForFamily = action({
  args: { spaceId: v.id("spaces") },
  returns: v.object({ inboxId: v.string(), email: v.string() }),
  handler: async (ctx, { spaceId }): Promise<{ inboxId: string; email: string }> => {
    const family: { name: string; existingInboxId: string | null } = await ctx.runQuery(
      internal.spaces.prepareInboxCreation,
      { spaceId },
    );
    if (family.existingInboxId) {
      const existing: unknown = await agentmail.getInbox(ctx, family.existingInboxId);
      return parseInbox(existing);
    }

    const created: unknown = await agentmail.createInbox(ctx, {
      displayName: `${family.name} family inbox`,
      clientId: `saathi-family-${spaceId}`,
    });
    const inbox = parseInbox(created);
    await ctx.runMutation(internal.spaces.attachCreatedInbox, { spaceId, inboxId: inbox.inboxId });
    return inbox;
  },
});

function parseInbox(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new ConvexError({ code: "PROVIDER_ERROR", message: "AgentMail returned an invalid inbox" });
  }
  const inbox = value as Record<string, unknown>;
  if (typeof inbox.inbox_id !== "string" || typeof inbox.email !== "string") {
    throw new ConvexError({ code: "PROVIDER_ERROR", message: "AgentMail returned an invalid inbox" });
  }
  return { inboxId: inbox.inbox_id, email: inbox.email };
}
