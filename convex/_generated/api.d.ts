/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentWorker from "../agentWorker.js";
import type * as agentmailInboxes from "../agentmailInboxes.js";
import type * as agents from "../agents.js";
import type * as attachments from "../attachments.js";
import type * as auth from "../auth.js";
import type * as budget from "../budget.js";
import type * as composioWebhook from "../composioWebhook.js";
import type * as conversationActions from "../conversationActions.js";
import type * as email from "../email.js";
import type * as gmail from "../gmail.js";
import type * as gmailData from "../gmailData.js";
import type * as http from "../http.js";
import type * as images from "../images.js";
import type * as inbox from "../inbox.js";
import type * as inboxWorkflow from "../inboxWorkflow.js";
import type * as invitations from "../invitations.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_saathi from "../lib/saathi.js";
import type * as liveVoice from "../liveVoice.js";
import type * as mentions from "../mentions.js";
import type * as messages from "../messages.js";
import type * as rooms from "../rooms.js";
import type * as spaces from "../spaces.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentWorker: typeof agentWorker;
  agentmailInboxes: typeof agentmailInboxes;
  agents: typeof agents;
  attachments: typeof attachments;
  auth: typeof auth;
  budget: typeof budget;
  composioWebhook: typeof composioWebhook;
  conversationActions: typeof conversationActions;
  email: typeof email;
  gmail: typeof gmail;
  gmailData: typeof gmailData;
  http: typeof http;
  images: typeof images;
  inbox: typeof inbox;
  inboxWorkflow: typeof inboxWorkflow;
  invitations: typeof invitations;
  "lib/authz": typeof lib_authz;
  "lib/saathi": typeof lib_saathi;
  liveVoice: typeof liveVoice;
  mentions: typeof mentions;
  messages: typeof messages;
  rooms: typeof rooms;
  spaces: typeof spaces;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agentmail: import("@agentmail/convex/_generated/component.js").ComponentApi<"agentmail">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  firecrawl: import("@firecrawl/firecrawl-convex/_generated/component.js").ComponentApi<"firecrawl">;
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
