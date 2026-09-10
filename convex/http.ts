import { AgentMail } from "@agentmail/convex";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { components, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();
const agentmail = new AgentMail(components.agentmail, {
  onMessageReceived: internal.email.onMessageReceived,
});

// Register exact security-sensitive routes before the static SPA catch-all.
auth.addHttpRoutes(http);
http.route({
  path: "/agentmail/webhook",
  method: "POST",
  // AgentMail 0.1.0's context type predates Convex's transaction-limits option.
  handler: httpAction((ctx, request) =>
    agentmail.handleWebhook(ctx as unknown as Parameters<typeof agentmail.handleWebhook>[0], request),
  ),
});
registerStaticRoutes(http, components.staticHosting);

export default http;
