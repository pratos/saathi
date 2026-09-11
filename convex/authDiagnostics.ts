import { v } from "convex/values";
import { env, internalAction } from "./_generated/server";

export const checkAgentMailConfiguration = internalAction({
  args: {},
  returns: v.object({
    apiKeyConfigured: v.boolean(),
    inboxIdConfigured: v.boolean(),
    inboxReachable: v.boolean(),
    inboxStatus: v.union(v.number(), v.null()),
  }),
  handler: async () => {
    const apiKey = env.AGENTMAIL_API_KEY.trim();
    const inboxId = env.AGENTMAIL_AUTH_INBOX_ID.trim();
    if (!apiKey || !inboxId) {
      return {
        apiKeyConfigured: Boolean(apiKey),
        inboxIdConfigured: Boolean(inboxId),
        inboxReachable: false,
        inboxStatus: null,
      };
    }

    try {
      const response = await fetch(
        `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      return {
        apiKeyConfigured: true,
        inboxIdConfigured: true,
        inboxReachable: response.ok,
        inboxStatus: response.status,
      };
    } catch {
      return {
        apiKeyConfigured: true,
        inboxIdConfigured: true,
        inboxReachable: false,
        inboxStatus: null,
      };
    }
  },
});
