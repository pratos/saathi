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
      try {
        const existing: unknown = await agentmail.getInbox(ctx, family.existingInboxId);
        return parseInbox(existing);
      } catch (error) {
        throw providerError(error);
      }
    }

    try {
      const created: unknown = await agentmail.createInbox(ctx, {
        displayName: `${family.name} family inbox`,
        clientId: `saathi-family-${spaceId}`,
      });
      const inbox = parseInbox(created);
      await ctx.runMutation(internal.spaces.attachCreatedInbox, { spaceId, inboxId: inbox.inboxId });
      return inbox;
    } catch (error) {
      throw providerError(error);
    }
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

function providerError(error: unknown) {
  if (error instanceof ConvexError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const status = Number(message.match(/AgentMail API error (\d{3})/)?.[1]);
  console.error(`AgentMail inbox operation failed (${Number.isFinite(status) ? status : "unknown status"})`);
  if (status === 401) {
    return new ConvexError({ code: "AGENTMAIL_AUTH", message: "AgentMail rejected the configured API key" });
  }
  if (status === 403) {
    return new ConvexError({ code: "AGENTMAIL_PERMISSION", message: "The AgentMail key cannot create inboxes" });
  }
  if (status === 429) {
    return new ConvexError({ code: "AGENTMAIL_RATE_LIMIT", message: "AgentMail is temporarily rate limited" });
  }
  return new ConvexError({ code: "AGENTMAIL_UNAVAILABLE", message: "AgentMail could not create the inbox" });
}
