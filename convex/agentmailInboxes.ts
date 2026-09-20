import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, env } from "./_generated/server";
import { validateFamilyAlias } from "./lib/familyAlias";

export const checkAlias = action({
  args: { username: v.string() },
  returns: v.object({ available: v.boolean(), username: v.string() }),
  handler: async (ctx, args): Promise<{ available: boolean; username: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in required" });
    const username = validateFamilyAlias(args.username);
    const taken: boolean = await ctx.runQuery(internal.spaces.aliasTaken, { username });
    if (taken) return { available: false, username };
    try {
      await agentmailRequest(`/inboxes/${encodeURIComponent(username)}`);
      return { available: false, username };
    } catch (error) {
      if (error instanceof AgentMailRequestError && error.status === 404) return { available: true, username };
      throw providerError(error);
    }
  },
});

export const createForFamily = action({
  args: { spaceId: v.id("spaces"), username: v.optional(v.string()) },
  returns: v.object({ inboxId: v.string(), email: v.string() }),
  handler: async (ctx, { spaceId, username }): Promise<{ inboxId: string; email: string }> => {
    const family: { name: string; existingInboxId: string | null } = await ctx.runQuery(
      internal.spaces.prepareInboxCreation,
      { spaceId },
    );
    if (family.existingInboxId) {
      try {
        const existing = await agentmailRequest(`/inboxes/${encodeURIComponent(family.existingInboxId)}`);
        return parseInbox(existing);
      } catch (error) {
        throw providerError(error);
      }
    }

    const alias = username ? validateFamilyAlias(username) : undefined;
    if (alias) {
      const taken: boolean = await ctx.runQuery(internal.spaces.aliasTaken, { username: alias });
      if (taken) throw new ConvexError({ code: "ALIAS_TAKEN", message: "That family email is already used" });
    }

    try {
      const created = await agentmailRequest("/inboxes", {
        method: "POST",
        body: JSON.stringify({
          ...(alias ? { username: alias } : {}),
          display_name: `${family.name} family inbox`,
          client_id: `saathi-family-${spaceId}`,
        }),
      });
      const inbox = parseInbox(created);
      await ctx.runMutation(internal.spaces.attachCreatedInbox, { spaceId, inboxId: inbox.inboxId, email: inbox.email });
      return inbox;
    } catch (error) {
      if (error instanceof AgentMailRequestError && (error.status === 409 || error.status === 422)) {
        throw new ConvexError({ code: "ALIAS_TAKEN", message: "That family email is already used" });
      }
      throw providerError(error);
    }
  },
});

async function agentmailRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`https://api.agentmail.to/v0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.AGENTMAIL_API_KEY.trim()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) throw new AgentMailRequestError(response.status);
  return response.json();
}

class AgentMailRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("AgentMail request failed");
    this.status = status;
  }
}

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
  const status = error instanceof AgentMailRequestError ? error.status : Number.NaN;
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
