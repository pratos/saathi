# Saath Product and Technical Specification

> **Product source of truth.** Product direction, scope, and implementation decisions belong in this document. Update it when a decision changes; do not let the application and this specification drift apart.

**Status:** Working specification, updated 10 September 2026  
**Name:** **Saath** (साथ, “together”); **Saathi** is the AI participant  
**Audience:** Households and small trusted groups whose members use different languages and have different levels of comfort with technology

## Product decision

Build Saath as a multilingual family operations inbox and shared messenger. A household gets one place for conversations, forwarded email, subscriptions, bills, school notices, bookings, attachments, decisions, and follow-ups. People participate through the web app or a scoped email thread. Saathi translates, summarizes, extracts important dates and amounts, researches current public information, and drafts actions without taking externally visible action without confirmation.

The hackathon application is a standalone React and TypeScript web app backed by Convex. Convex is the system of record and authorization boundary. DeepSeek V4.1 Flash through OpenRouter handles routine multilingual chat and translation. OpenAI retains a narrow, real product role for structured email extraction and suggested replies so the submission clearly satisfies sponsor-stack requirements. Firecrawl retrieves current public evidence, and AgentMail provides the household inbox and threaded email delivery.

Pi, box.ascii.dev, bring-your-own API keys, SMS authentication, and billing are not required for the core product loop and are deferred until the measured product need justifies them.

## Product promise

A family can forward or receive an important email, discuss it in their preferred languages, understand what must happen next, and reply from one shared record. Every derived translation or AI result remains connected to the original source.

## Product principles

1. **The source remains visible.** Preserve original messages, emails, attachments, sender, and timestamps.
2. **Language belongs to the reader.** Every member chooses a display language without changing the canonical record.
3. **One household, deliberate visibility.** Shared by default only where intended; private items never leak into family search, summaries, or AI context.
4. **AI assists; people decide.** Saathi may classify, translate, summarize, research, and draft. Sending, unsubscribing, deleting, purchasing, or changing a service requires confirmation.
5. **Email is a first-class input.** AgentMail is not a demo add-on; it is the bridge between household operations and the shared workspace.
6. **Deny by default.** A valid identifier is not permission. Every server operation proves identity and authorization.
7. **Convex owns durable truth.** Provider responses and execution events are normalized into Convex records; provider state is never canonical.
8. **Families are isolated tenants.** One person may belong to multiple family spaces, but data, permissions, inboxes, usage, and model context never cross a space boundary.

# Core Experience

## Primary jobs

- Keep household email and conversations in one understandable place.
- Understand mixed-language family communication without relying on one person as translator.
- Turn bills, notices, bookings, and subscription emails into dates, amounts, decisions, and assigned tasks.
- Include an outside participant by email without requiring a Saath account.
- Ask Saathi for help within the authorized conversation and source material.
- Research current public information with visible URLs and retrieval times.
- Catch up on unread items, decisions, unresolved questions, renewals, and responsibilities.

## Multiple family spaces

One account can create or join multiple family spaces—for example, a household, a parent’s household, and a resident group. The user chooses an active space from a switcher; switching changes the complete authorization and data scope rather than applying a client-side filter.

Each space independently owns its members, AgentMail inbox, room grants, inbox items, usage limits, audit history, language mix, and retention settings. A membership row grants a user a role in exactly one space. Cross-space search, summaries, tasks, model context, and email routing are forbidden. Email addresses must resolve to one space before content is processed.

## Family inbox

Each family space receives one AgentMail-powered address, for example `kapoor-family@saath.email`. Members can use it as a subscription contact or forward existing email into it.

Incoming items are classified into views such as:

- Bills and payments
- School and family
- Travel and bookings
- Subscriptions and renewals
- Home and community
- Receipts and warranties
- Needs review

Classification is metadata, not a separate copy of the message. An inbox item can be discussed in a linked room while retaining one canonical source.

### Inbox processing

1. AgentMail sends a signed inbound webhook.
2. Convex acknowledges promptly, verifies authenticity, and schedules processing.
3. Saath deduplicates using the AgentMail message ID.
4. Saath maps the inbox and thread to a family space.
5. Known routing rules determine initial visibility; uncertain or unknown senders enter **Needs review**.
6. OpenAI classifies the item and extracts bounded fields such as amount, due date, renewal date, reference number, and requested action.
7. The original email and attachments remain available beside all derived fields.
8. Authorized members receive a realtime update in their preferred language.

Forwarded personal mail remains private to the forwarding member until they explicitly share it. Sender address alone never proves that a message is trusted.

## Rooms

| Room | Membership | Typical use |
| --- | --- | --- |
| Private | One member and Saathi | Personal drafting, private forwarded mail, document explanation |
| Shared | Explicit family members | Household planning, school coordination, decisions |
| Case | Selected members and optional email guests | Booking, purchase, application, service request, or subscription issue |

A solo room can become shared without losing history. Before conversion, the owner sees exactly which existing messages will become visible.

## Multilingual behavior

Launch languages are English, Hindi, and Marathi.

- Store the original text and detected language immediately.
- Generate each `(message, targetLanguage)` translation once and reuse it.
- Show translated text by default when it differs from the reader’s language.
- Provide **View original** and a clear `Translated by Saathi` label.
- Preserve names, dates, amounts, addresses, URLs, reference numbers, and citations.
- Flag uncertain extraction rather than silently inventing a value.
- Create one canonical assistant response and derive reader-language views from it.
- Ordinary human conversation does not invoke Saathi unless mentioned or explicitly requested.

## Saathi

Saathi participates automatically in a private AI room and only when mentioned or explicitly invoked in shared rooms and cases.

Saathi can:

- translate and explain a message or email;
- summarize unread activity;
- extract dates, amounts, renewal terms, decisions, and tasks;
- compare a subscription price with prior messages;
- research current public information through Firecrawl;
- draft a reply, reminder, or unsubscribe request;
- cite the original household item and any public web sources used.

Saathi cannot autonomously send email, unsubscribe, make a purchase, follow a payment link, delete household data, invite a member, or change access.

## Mobile-first account setup

The long-term onboarding flow is:

1. Enter a mobile number with a country selector, defaulting to `+91`.
2. Verify a six-digit SMS OTP.
3. Choose a display name and preferred language.
4. Join an invited family space or create one.
5. Optionally add a recovery method when supported.

Phone numbers are stored in E.164 form and are not displayed to other members without consent. SMS OTP requires expiry, resend cooldowns, attempt limits, abuse controls, and a production messaging provider.

For the hackathon MVP, use email OTP only. It requests no social profile and avoids requiring a Google account. Convex Auth also supports SMS OTP through a custom phone provider, with an official Twilio/Twilio Verify example, but it does not include an SMS delivery service. Google OAuth and the mobile flow are deferred to avoid unrelated providers and unreliable demo dependencies.

# Authentication and Authorization

Authentication answers **who is calling**. Authorization answers **what that identity may do to this resource**. Email OTP, future OAuth or mobile verification, AgentMail sender checks, and application roles are separate trust boundaries.

## App authentication

Use Convex Auth v2 (`@convex-dev/auth`) with email OTP as the only MVP sign-in method. AgentMail delivers the code. The product deliberately accepts Convex Auth’s beta/pre-release maturity to keep identity and sessions within the Convex application boundary. Pin the package version and cover OTP issuance, expiry, attempt limits, session refresh, and sign-out with integration tests.

- OTP and session-signing secrets live only in Convex environment variables.
- Development and production use separate signing keys, callback URLs, and AgentMail inboxes.
- The stable provider identity, not a client-supplied email address, identifies an account.
- Future account linking requires verified provider claims and must not be implemented by manually matching email strings.
- The client uses the Convex Auth session; it never stores provider or application secrets.
- A user record is provisioned server-side after the first authenticated request.

AgentMail guests do not receive app sessions. Their restricted identity comes from a verified webhook, an active email thread mapping, and an allowed sender address.

## Role model

Roles are assignments. Backend policies convert assignments into specific capabilities.

### Space roles

| Capability | Owner | Member |
| --- | :---: | :---: |
| View space profile | Yes | Yes |
| Create a room | Yes | Yes |
| Manage members and invitations | Yes | No |
| Configure inbox and routing | Yes | No |
| View usage and limits | Yes | Own activity only |
| Export or delete the space | Yes, with confirmation | No |

Every space has at least one owner. Ownership transfer must be atomic; the final owner cannot leave or remove themselves without transferring ownership or deleting the space.

### Room roles

| Capability | Manager | Participant | Viewer | Email guest |
| --- | :---: | :---: | :---: | :---: |
| Read authorized history | Yes | Yes | Yes | Thread only |
| Post app messages | Yes | Yes | No | No |
| Reply by email | Optional | Optional | No | Thread only |
| Upload attachments | Yes | Yes | No | Email thread only |
| Invoke Saathi | Yes | Yes | No | Only when enabled |
| Send confirmed external reply | Yes | Yes | No | Normal email reply |
| Change room members/settings | Yes | No | No | No |

An owner does not automatically read every private room. Space administration and room content access are deliberately separate.

## Policy enforcement

All public Convex queries, mutations, and actions must begin through shared policy functions:

```ts
requireUser(ctx)
requireSpacePermission(ctx, spaceId, "manage_members")
requireRoomPermission(ctx, roomId, "post_message")
requireInboxItemPermission(ctx, itemId, "read")
```

Policy rules:

- Deny when no explicit rule grants access.
- Resolve membership from Convex on every request; never accept a role from client arguments.
- Scope list queries through membership indexes instead of fetching globally and filtering afterward.
- Re-authorize AI actions before loading context and again before committing externally visible results.
- Internal functions remain narrow and receive trusted identifiers only from an already-authorized public boundary or scheduler.
- Private room and inbox content cannot enter family-wide search, summaries, digests, or model context.
- Membership revocation affects the next request and all reactive subscriptions.
- UI hiding is convenience, never enforcement.

## Invitations

- Generate at least 256 bits of randomness.
- Store only a hash of the invitation token.
- Bind invitations to a space, intended role, normalized email or verified mobile number, expiry, and creator.
- Make acceptance atomic and single-use.
- Require the authenticated identity to match the invitation target.
- Record creation, acceptance, revocation, and expiry as audit events.

## External-action policy

Drafting and executing are separate operations. Sending email, unsubscribing, deleting, exporting, or changing membership requires a fresh permission check and explicit confirmation containing the final action details. Retried requests use an idempotency key.

# Sponsor Integrations

## Convex

Convex owns users, spaces, memberships, room grants, inbox items, messages, translations, attachments, tasks, invitations, agent runs, sources, audit events, idempotency, and usage. Queries power realtime authorized views. Mutations validate and write atomically. Actions call external services and write results through internal mutations.

Selected components:

- `@convex-dev/static-hosting` for the required `convex.site` deployment;
- Convex Auth v2 (`@convex-dev/auth`) for email OTP and sessions;
- `@agentmail/convex` for persisted inbound email, threading, queued sends, and delivery status;
- `@convex-dev/rate-limiter` for OTP, AI, crawl, and outbound-send abuse controls;
- `@convex-dev/workflow` for the durable email → classify → extract → publish pipeline;
- `@firecrawl/firecrawl-convex` for current public web retrieval;
- optionally `@convex-dev/action-cache` for space-scoped translation and classification caching.

Keep family RBAC, messages, usage, and audit records in app-owned tables. Do not stack Workflow, Workpool, and Action Retrier for the same job. Early component versions must be pinned and covered by integration tests; appearance in the component directory is not a maintenance guarantee.

The Photon iMessage component is a candidate for later SMS, RCS, and iMessage delivery. It is a durable messaging transport, not an auth provider. Phone login would still use a custom Convex Auth phone provider to generate/verify the OTP while Photon sends it. Do not add Photon to the hackathon dependency graph until delivery to the target countries, sender provisioning, pricing, abuse controls, and fallback behavior are verified.

## Default model routing

- **Default Family:** OpenRouter `deepseek/deepseek-v4.1-flash` for routine multilingual chat, translation, and summaries.
- **Low — Luna:** latest approved economical OpenAI model.
- **Mid — Terra:** latest approved balanced OpenAI model.
- **High — Sol:** latest approved high-capability OpenAI model.
- **Ultra — Astra:** latest approved maximum-capability OpenAI model.
- **Hackathon OpenAI role:** direct OpenAI for structured email-to-task extraction and suggested replies, regardless of whether a member changes their conversational profile.
- **Optional image generation:** OpenRouter `google/gemini-3.1-flash-lite-image` (“Nano Banana 2 Lite”) for deliberately requested family cards or visual explainers. It is not in the core MVP path.

Luna, Terra, Sol, and Astra are stable Saath product profiles, not claimed OpenAI API model IDs. A server-side routing table maps them to currently approved provider model IDs. Every run persists both the requested profile and resolved provider/model for reproducibility and usage accounting. A space owner can cap the highest available profile; members may switch within that policy, and expensive High or Ultra work can require a visible estimate and confirmation. No physical dial UI is part of the present implementation.

One OpenRouter key covers both DeepSeek and Nano Banana. The `convex-nano-banana` component is not selected because its documented interface expects a direct Gemini key rather than OpenRouter.

## OpenAI

OpenAI is called only from server-side Convex actions. For the MVP, `gpt-5-mini` performs structured email extraction and suggested replies. Outputs are validated with Zod, with at most one repair attempt. Record model, latency, token usage when available, validation outcome, and trace ID.

The web client never receives the OpenAI API credential. Managed API usage is capped per family space. Bring-your-own API keys are deferred until secure storage, validation, rotation, revocation, and support behavior are complete.

## Firecrawl

Firecrawl is used only when a request requires current public information. The action sends a public search question—not private household content—stores URLs and retrieval timestamps, and gives bounded evidence to the selected text model for synthesis. The resulting answer visibly cites its sources.

## AgentMail

Use one AgentMail inbox per family space and one email thread per case.

AgentMail provides:

- inbound household mail and forwarded messages;
- scoped participation for people without Saath accounts;
- attachments and email provenance;
- outbound invitations, notifications, and confirmed replies;
- standard email threading for app-to-email conversations.

Inbound processing verifies webhook authenticity, inbox mapping, thread mapping, sender policy, and idempotency before attachments or body content are processed. Unknown senders are quarantined. An app reply uses the latest AgentMail thread context and requires confirmation.

# Configuration and API Keys

All secrets live in Convex deployment environment variables or the deployment platform’s encrypted CI secret store. They never use a `VITE_` prefix and never enter browser bundles, messages, logs, or Box environments.

| Credential/configuration | Required | Purpose |
| --- | :---: | --- |
| Convex project/deployment | Yes | Database, functions, realtime, storage, and hosting |
| `VITE_CONVEX_URL` | Yes, public | Browser endpoint; configuration, not a secret |
| `CONVEX_DEPLOY_KEY` | CI only | Automated deployment; not needed in the browser or normal local runtime |
| `JWT_PRIVATE_KEY` and `JWKS` | Yes | Convex Auth session token signing and verification |
| `SITE_URL` | Yes, configuration | Safe OTP return destination |
| AgentMail API key | Yes | Create/use family inboxes and send confirmed replies |
| AgentMail webhook signing secret | Yes | Verify inbound AgentMail events |
| Firecrawl API key | Yes | Current public web search and retrieval |
| OpenRouter API key | Yes | DeepSeek V4.1 Flash and optional Nano Banana requests |
| OpenAI API key | Yes for hackathon | Direct extraction/reply role and optional Luna/Terra/Sol/Astra profiles |
| Photon/Spectrum project ID and secret | Later only | SMS, RCS, or iMessage transport, including a possible Auth OTP adapter |

AgentMail delivers login OTP emails, avoiding a separate transactional-email provider. No Gemini key is needed when Nano Banana is accessed through OpenRouter. SMS login later adds the selected transport’s server-side credentials: Photon/Spectrum project credentials if its delivery model is selected, or Twilio credentials and a Verify Service SID if Twilio Verify is selected. Development and production use separate webhook endpoints, signing keys, inboxes, and provider secrets.

# Data Model

| Table | Purpose | Important fields |
| --- | --- | --- |
| `users` | App identity and preferences | auth subject, display name, preferred language, optional verified phone |
| `spaces` | Household trust boundary | name, owner policy, AgentMail inbox ID, usage policy |
| `memberships` | Space assignment | space ID, user ID, owner/member role, status |
| `rooms` | Private/shared/case conversation | space ID, type, title, assistant mode |
| `roomMembers` | Fine-grained room access | room ID, principal ID/type, room role |
| `inboxItems` | Canonical incoming household email | space ID, sender, subject, original body, visibility, category, status |
| `emailThreads` | AgentMail routing | space ID, room ID, inbox ID, thread ID, allowed senders |
| `messages` | Ordered conversation log | room ID, actor, origin, original text, language, idempotency key |
| `translations` | Reader-language cache | message/inbox item ID, target language, text, model, confidence |
| `attachments` | Stored files and extraction state | parent ID, storage ID, media type, status, visibility |
| `tasks` | Household follow-ups | source ID, title, assignee, due date, status, confidence |
| `invitations` | Hashed, expiring membership grants | token hash, target, role, expiry, accepted/revoked time |
| `agentRuns` | AI lifecycle and audit record | scope, trigger, status, capability, model, usage, idempotency key |
| `webSources` | Firecrawl evidence | run ID, URL, title, retrieval time, excerpt hash |
| `auditEvents` | Security-relevant history | actor, action, resource, safe metadata, timestamp |
| `usageLedger` | Provider metering | space ID, run ID, provider, units, cost class, timestamp |

Indexes must support identity lookup, active space membership, room membership, room message ordering, inbox/category ordering, AgentMail message deduplication, translation caching, invitation hash lookup, and agent-run idempotency.

# Canonical Event and Execution Model

Every inbound item records an origin, actor, space or room, original content, visibility, and idempotency key.

| Origin | Idempotency key | Required check |
| --- | --- | --- |
| Native app | Client operation ID | Authenticated principal can perform the capability |
| AgentMail | AgentMail message ID | Verified webhook, mapped inbox/thread, permitted sender |
| Assistant | Run ID plus output sequence | Authorized trigger and active run |

## Native message and assistant reply

1. The client calls a mutation with a client operation ID.
2. The mutation verifies room access and inserts the original message once.
3. Reactive queries update authorized clients immediately.
4. The mutation schedules translation and, when invoked, creates an agent run.
5. The action loads only authorized bounded context, calls the required provider, validates output, and records usage.
6. An internal mutation inserts one canonical assistant response using the run idempotency key.
7. Reader-language translations update reactively.

## Email to family inbox

1. AgentMail receives or is forwarded an email.
2. Its signed webhook reaches a Convex HTTP action.
3. Convex verifies and acknowledges the event, then schedules processing.
4. Processing resolves space, visibility, thread, and sender policy.
5. A mutation inserts the inbox item exactly once.
6. OpenAI classifies and extracts structured fields; translations are generated only for required languages.
7. Members see the item live and can open a discussion or create a task.

## Confirmed reply

1. Saathi or a member creates a draft associated with a case thread.
2. The UI displays recipients, subject, body, and attachments.
3. An authorized member confirms.
4. A mutation records a pending send with an idempotency key.
5. A Convex action sends through AgentMail.
6. A result mutation records delivery metadata or a visible failure without duplicating the room message.

# Trust, Privacy, and Safety

- Preserve original content beside translations and structured extraction.
- Label AI-generated translations, summaries, research, classifications, and drafts.
- Apply per-item visibility to messages, email, attachments, search, model context, and exports.
- Do not log message bodies, credentials, invitation tokens, OTPs, or attachment contents.
- Store provider credentials only in server-side environment variables.
- Scan or reject unsupported attachments before extraction; enforce type and size limits.
- Store source URLs and retrieval timestamps for web-grounded answers.
- Apply daily and monthly AI caps before expensive work.
- Rate-limit login, OTP, invitation, webhook, AI, and outbound-email paths.
- Provide retention and deletion controls before real households upload sensitive documents.
- Do not claim end-to-end encryption; the server must process content for translation and assistance.

## Required adversarial tests

- A non-member cannot list, read, infer, search, translate, or invoke AI against a room.
- A member of one family cannot infer IDs, membership, inbox items, search results, usage, or model context from another family.
- A multi-family user can switch spaces without stale data from the previous space remaining subscribed or visible.
- A space owner cannot read a private room without a room grant.
- Removing membership terminates subsequent reads and writes.
- A viewer cannot post by calling a mutation directly.
- A client cannot elevate privileges by supplying a role.
- An invitation cannot be reused, accepted after expiry, or accepted by the wrong identity.
- Duplicate native, AgentMail, assistant, and outbound-send operations create one canonical record.
- An unknown email sender cannot bypass quarantine through a forged thread identifier.
- Private content is absent from family summaries and Firecrawl requests.
- A stale authorized AI run cannot commit after access is revoked.

# Hackathon MVP

The official hackathon requires a new app, Convex as the backend, meaningful work from OpenAI, Firecrawl, and AgentMail, a public `convex.site` or `chatgpt.site` frontend, a public repository, `hackathon.md`, a social post, and a video under three minutes.

## Included

- Email OTP through Convex Auth v2, delivered by AgentMail.
- One demo family space and one AgentMail inbox.
- Realtime shared and case rooms with server-enforced room membership.
- English, Hindi, and Marathi preferences with original reveal and translation caching.
- Family inbox with Bills, School, Travel, Subscriptions, and Needs review views.
- Inbound email deduplication, classification, structured extraction, and visibility.
- A case email guest and one confirmed app-to-email reply.
- Mention-based Saathi summaries and drafts.
- One current-information request with Firecrawl citations.
- Usage ledger, hard demo limits, audit events, and visible failure states.
- Public deployment, reproducible demo account, build log, and sub-three-minute demo.

## Deferred

- SMS OTP and phone-number login implementation.
- WhatsApp, SMS, RCS, voice notes, and contact-book import.
- Automatic unsubscribing, payments, purchases, bookings, or formal outbound actions.
- General-purpose shell execution and box.ascii.dev jobs.
- Pi agent runtime unless direct provider integration proves insufficient.
- Bring-your-own model keys and production billing.
- End-to-end encryption claims and regulated health or financial workflows.
- General bot marketplace and broad workflow automation.

## Acceptance criteria

| Capability | Pass condition |
| --- | --- |
| Authentication | A user signs in with a valid, unexpired email OTP and receives no access before verification |
| Authorization | Direct calls by a non-member or wrong room role are rejected server-side |
| Multi-family isolation | One account can switch between two spaces without cross-space reads, subscriptions, search, or AI context |
| Realtime | Two authorized sessions see a new message, inbox item, and run status without refresh |
| Multilingual | Sessions render the same source in different preferred languages and reveal the original |
| Family inbox | One forwarded email appears once, is categorized, and exposes its original provenance |
| Extraction | A bill or renewal produces independently verifiable amount/date fields with confidence |
| Assistant | An `@Saathi` request creates one canonical answer and localized views |
| Web research | The answer includes at least one retrievable Firecrawl URL and retrieval time |
| Email bridge | An allowed reply appears once and a confirmed app reply remains in the same thread |
| Privacy | A private item is absent from another member’s queries, summaries, and AI context |
| External action | A draft cannot be sent without an authorized confirmation operation |
| Usage | Every AI run records owning space, provider, model, and available token counts |
| Submission | Public app, public repository, build log, social post, and video are complete |

# Three-Minute Demo

1. Asha signs in and opens the Kapoor family inbox.
2. A forwarded Hindi school notice appears live, categorized under School. Asha reads the English translation and reveals the original.
3. A subscription renewal email shows the renewal date, amount, and price change extracted from the original.
4. Asha asks `@Saathi` whether the current plan is competitive. Firecrawl retrieves current public options and Saathi answers with visible sources.
5. A travel agent replies to a scoped case by email. The reply appears once in both authorized browser sessions.
6. Saathi drafts a response; Asha reviews the exact recipient and body before confirming the AgentMail send.
7. A second browser demonstrates Marathi display and is denied access to Asha’s private forwarded item.
8. The final view shows original sources, translations, email provenance, run status, and household usage.

# Success Measures

- A new user reaches a useful family inbox item in under two minutes.
- A second member understands a message without language setup help from another person.
- At least one real email completes an inbound and outbound round trip.
- A household can identify an amount, due date, responsible person, and next action from an incoming item.
- Judges can identify meaningful work performed by Convex, OpenAI, Firecrawl, and AgentMail.
- No demo step requires localhost, manual database edits, or unconfirmed external actions.

# Delivery Plan

| Dates | Outcome | Evidence |
| --- | --- | --- |
| 10–12 September | Schema, auth, RBAC, family shell, rooms | Authorization tests and two-session realtime check |
| 13–15 September | AgentMail inbox, inbound processing, classification | Real forwarded email and duplicate-delivery test |
| 16–17 September | Language preferences, translation cache, extraction | English/Hindi/Marathi fixture tests |
| 18–19 September | Saathi, Firecrawl research, confirmed reply | Cited query and email round trip |
| 20 September | Usage caps, audit, privacy and failure states | Adversarial policy suite |
| 21 September | Public deployment and final build log | Fresh-device walkthrough |
| 22 September | Demo and submission before 12 PM Pacific | Submission receipt and live links |

# Decisions

| Decision | Current choice | Revisit when |
| --- | --- | --- |
| Product name | Saath; assistant is Saathi | Before domain purchase |
| Product center | Family operations inbox plus multilingual conversation | User testing contradicts it |
| Launch languages | English, Hindi, Marathi | First household research |
| Authentication | Convex Auth v2 with AgentMail-delivered email OTP only; OAuth and mobile OTP later | Recovery or user research requires another method |
| Authorization | Capability policies over space and room assignments | A new collaboration model requires it |
| Multi-family tenancy | Users may hold independent memberships in multiple isolated spaces | Evidence requires a more complex organization hierarchy |
| Email topology | One AgentMail inbox per space, one thread per case | Tenant isolation or deliverability requires more |
| AI boundary | DeepSeek V4.1 Flash by default; OpenAI profiles Luna/Terra/Sol/Astra plus mandatory extraction/draft role | Benchmarks or sponsor guidance changes |
| Image model | Optional Nano Banana 2 Lite through OpenRouter | A validated core workflow needs generated images |
| Assistant trigger | Mention in shared rooms; automatic in private AI rooms | Missed-request data suggests otherwise |
| Firecrawl boundary | Current public information only | A reviewed private-source connector is added |
| External actions | Draft then explicit authorized confirmation | Never for payments or destructive actions |
| Schema validation | Zod | A platform constraint requires another library |
| Box and shell execution | Deferred | A narrow user job cannot be solved safely otherwise |
| BYO API keys | Deferred | Secret lifecycle and support are ready |
| Pricing | Unset | Ten real household sessions are measured |

# Sources

Product availability and hackathon rules can change; recheck before submission.

1. [Convex All Gas Hackathon](https://www.convex.dev/hackathons/all-gas) — requirements, sponsor stack, judging, deployment, and submission.
2. [Convex Components](https://www.convex.dev/components) — component catalog and maintenance ownership.
3. [Convex Authentication](https://docs.convex.dev/auth) — supported authentication boundaries and providers.
4. [Convex Auth in Functions](https://docs.convex.dev/auth/functions-auth) — server-side identity access.
5. [OpenAI API](https://developers.openai.com/api/reference/overview) — server-side model API and credential handling.
6. [AgentMail Webhooks](https://www.agentmail.to/docs/webhooks-overview) — inbound events and message metadata.
7. [AgentMail Threaded Conversations](https://www.agentmail.to/docs/knowledge-base/threaded-conversations) — standard email threading and replies.
8. [Convex Realtime](https://docs.convex.dev/realtime) — reactive queries and updates.
9. [Firecrawl Convex Component](https://www.firecrawl.dev/blog/firecrawl-convex-component) — public web retrieval from Convex.
10. [OpenRouter Models](https://openrouter.ai/models) — model identifiers, capabilities, and current pricing.
11. [Convex Auth setup](https://labs.convex.dev/auth/setup) — React/Vite package and provider setup.
12. [Convex Auth OTPs](https://labs.convex.dev/auth/config/otps) — email OTP and custom Twilio phone-provider pattern.
13. [Photon iMessage Convex component](https://www.convex.dev/components/spectrum-ts/convex) — durable iMessage, RCS, and SMS transport.
