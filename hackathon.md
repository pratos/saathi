# Hackathon log

- **Project:** Saathi
- **Event:** Convex All Gas Hackathon
- **What it does:** A multilingual family operations inbox for shared email, conversations, translations, decisions, and follow-ups.
- **Live app:** https://giant-caiman-748.convex.site
- **Repo:** https://github.com/pratos/saathi
- **Frontend:** Convex static hosting
- **Convex deployment:** https://giant-caiman-748.convex.cloud
- **Components:** @agentmail/convex, @convex-dev/rate-limiter, @convex-dev/static-hosting, @convex-dev/workflow, @firecrawl/firecrawl-convex
- **Convex features:** schema, indexes, queries, mutations, actions, HTTP actions, file storage, realtime subscriptions, durable workflows, scheduled lease recovery
- **Auth:** Convex Auth
- **AI models:** openai/gpt-5.6-luna (default med), deepseek/deepseek-v4.1-flash (low), x-ai/grok-4.6 (high), openai/gpt-5.6-sol (ultra), meta/muse-image, gpt-live-1, gpt-5-mini, saaras:v3
- **Started:** 2026-09-10T11:35:28Z
- **Last updated:** 2026-09-22T14:06:38Z

## Log

### 2026-09-10 - b92bca9
Established Saathi as a multilingual family operations inbox and documented the
product boundary, source-linked translations, human confirmation gates, and the
initial responsive React interface (`PRODUCT.md`, `src/App.tsx`).

### 2026-09-10 - 4f803ad
Defined isolated family spaces so one account can participate in multiple
families without sharing inboxes, permissions, usage, or model context. Selected
the initial Convex component and provider stack (`PRODUCT.md`).

### 2026-09-10 - fc2462e
Specified deny-by-default authorization, room-level grants, model profiles, and
server-side provider routing for the default family model and higher-effort
OpenAI options (`PRODUCT.md`).

### 2026-09-10 - 338b47b
Narrowed MVP authentication to email OTP through Convex Auth, delivered by
AgentMail, and deferred OAuth and mobile OTP (`PRODUCT.md`).

### 2026-09-10 - 616cd58
Implemented the responsive family inbox preview, email OTP screens,
multi-family switching, source-language reveal, extracted facts, and guarded
reply confirmation, plus browser-recorded family voice notes with explicit
30-second limits, playback review, and family-only sharing (`src/App.tsx`,
`src/App.css`). Added the Convex schema,
authorization helpers, family-scoped queries and mutations, signed AgentMail
ingestion, rate limiting, and a durable OpenAI extraction workflow with
validated output and failure states (`convex/`). Added authorized Convex file
storage and server-side Sarvam Saaras v3 transcription for voice notes, with
rate limits, idempotency, processing states, safe failure audit, and usage
metering (`convex/schema.ts`, `convex/voiceNotes.ts`). Mounted AgentMail, Workflow,
Rate Limiter, Firecrawl, and Static Hosting components
(`convex/convex.config.ts`). Replaced the portal's unbundled module waterfall
with a single-file development preview, reducing cold external script requests
from 13 to zero while leaving the production build unchanged (`package.json`,
`vite.config.ts`, `.amp/services.yaml`). Corrected desktop grid sizing and
header alignment so detail actions and the reply composer remain fully visible
at wide review viewports (`src/App.css`).

Integrated the referenced Pi prototype as a production-shaped, room-scoped
Saathi runtime rather than copying its unauthenticated API. Added room RBAC,
per-family/user rate limiting, idempotent client operations, FIFO jobs, bounded
transcript context, explicit memory, a 12-turn cap, and attempt-specific leases that
reject stale worker completion after recovery. The worker uses OpenRouter
`deepseek/deepseek-v4.1-flash` under Convex's Node 22 runtime. Added Convex tests
covering manager/participant/outsider policy, retry deduplication, FIFO ordering,
exact recovery, and stale-lease rejection (`convex/agents.ts`,
`convex/agentWorker.ts`, `convex/agents.test.ts`, `convex.json`).

### 2026-09-11 - 194926f
Configured the Convex Auth issuer and verified a disposable local Convex
deployment in the orb. Live checks proved Auth discovery and JWKS, owner access,
outsider denial, idempotent message writes, and a completed durable DeepSeek
agent reply. The local deployment remains separate from production
(`convex/auth.config.ts`).

### 2026-09-11 - 87ae4cf
Added a GitHub Actions release path that lints and tests before the official
Static Hosting command builds against production, deploys the Convex backend,
and atomically publishes the frontend (`.github/workflows/deploy-convex.yml`,
`convex/README.md`).

### 2026-09-11 - production deployment
Deployed the Convex backend and registered components, then published the Vite
frontend through Convex Static Hosting. The public site and Convex Auth
discovery endpoint both returned HTTP 200.

### 2026-09-11 - 7bd6403
Separated the product into an account-free guided preview with fictional data
and a live workspace backed only by authenticated Convex family data. Added the
real email OTP entry flow, first-family onboarding, responsive family switching,
live inbox and conversation views, and an owner-only AgentMail inbox connection
with authorization and tenant-isolation tests. Rebuilt desktop and mobile around
a warm, high-contrast conversation surface with original-plus-translation cards,
48px actions, source-backed Saathi responses, a decision summary, and voice-note
capture (`src/App.tsx`, `src/App.css`,
`src/LiveWorkspace.tsx`, `src/PreviewWorkspace.tsx`, `convex/spaces.ts`). Turned
the seeded preview into an eight-step interactive replay covering simulated email
OTP, family creation, translated conversation, message sending, sample inbox
connection, isolated family switching, and sourced decision support. Added
play/pause, step, replay, and exit controls while keeping every action local to
the browser (`src/PreviewWorkspace.tsx`, `src/App.css`).

### 2026-09-11 - 08b676d
Changed authentication email from a background retry queue to a synchronous
AgentMail request, so Convex Auth advances only after the provider accepts the
OTP message. Declared the required OTP environment variables and retained a
per-address hourly rate limit (`convex/auth.ts`, `convex/convex.config.ts`).

### 2026-09-11 - 19dd839
Added room-scoped streamed Saathi replies with explicit mention activation and
ambient checks for ordinary family messages. Grounded web answers combine
OpenRouter web search with the Firecrawl component, and generated images use
`meta/muse-image` with authorized Convex file storage (`convex/agents.ts`,
`convex/agentWorker.ts`, `src/LiveWorkspace.tsx`).

### 2026-09-11 - be6f61c
Made family inbox onboarding self-service for owners by creating and attaching
an AgentMail inbox server-side. Added room-authorized photo and document uploads
with MIME and size limits, idempotent message records, realtime attachment
queries, inline previews, drag-and-drop, and upload states. Saathi responses now
render streamed Markdown with readable headings, lists, emphasis, code, and safe
links (`convex/agentmailInboxes.ts`, `convex/attachments.ts`,
`convex/attachments.test.ts`, `src/LiveWorkspace.tsx`, `src/App.css`).

### 2026-09-15 - 093738b
Added owner-managed, email-bound family invitations with hashed bearer tokens,
expiry, revocation, rate limits, identity-matched acceptance, and atomic family
and room grants. Added authenticated `gpt-live-1` WebRTC conversations with
live captions and idempotent room transcripts, while keeping the OpenAI key on
the Convex backend. Routed family inbox creation through the app-owned AgentMail
credential path used by working OTP delivery instead of relying on isolated
component environment state (`convex/invitations.ts`, `convex/liveVoice.ts`,
`convex/agentmailInboxes.ts`, `src/LiveWorkspace.tsx`). This update is locally
verified but not yet live-provider verified or deployed.

### 2026-09-15 - Saathi private workspace and integrations
Redesigned GPT-Live as a full-screen, bottom-up call experience with an organic
orb driven by real microphone and remote-audio amplitude, auto-scrolling live
captions, mute/end controls, and one authenticated, idempotent post-call summary
instead of raw turns in the room. Added one automatic **My Saathi** room per
family member with explicit room membership that family ownership cannot bypass;
the existing chat, file, voice-note, and live-call paths all enforce that same
boundary. Added multiple private Gmail accounts per member using current Composio
Sessions and managed OAuth, 30-day inbox backfill, signed
`GMAIL_NEW_GMAIL_MESSAGE` handling, and fail-closed usefulness classification.
Only useful household mail reaches the member's private inbox/chat; rejected
mail retains only an idempotency marker. Deterministic tests cover room and inbox
isolation, summary ownership/idempotency, Gmail retention, and Standard Webhooks
verification. Live Composio OAuth and webhook delivery still require the optional
production Convex variables and deliberate external webhook registration.

### 2026-09-15 - Money mail approval and food budget
Money-related Gmail now stays in My Saathi until the owner shares it. Shared items
become family-inbox entries. Food spend from approved Swiggy/Zomato receipts is
tracked against an owner-set monthly budget. Swiggy MCP ordering is not connected.

### 2026-09-15 - Family BYOK
Owners can save an OpenAI, OpenRouter, or Codex API key for their family.
Secrets are encrypted and never returned; only last-four is shown. ChatGPT
subscription login is not an API and is not used. Deployment env keys remain
the fallback.

### 2026-09-15 - Family photos and collages
Added collage, album-grid, scrapbook, and fridge-photo presets for household
memory images. Chat now has Photos, Camera, and Receipt capture. Images go to
Convex storage; a small vision model (`gpt-5-mini`) transcribes captions or
receipt merchant/amount. Camera and library use the same authorized upload path.

### 2026-09-15 - Family image presets
Chat and GPT-Live can generate family-safe images. Named presets cover
household scenes, language-specific infographics, modest devotional art, and
craft styles. Sexual, nude, and graphic requests are refused before the image
model runs. The selected preset is stored on the member profile.

### 2026-09-15 - Firecrawl Interact computer use
Explicit `@saathi` browse requests can open a public https page through Firecrawl
Interact. The running job streams an embeddable live view so a person can watch
and sign in in the hosted browser. Firecrawl persistent profiles save cookies and
localStorage per Saathi user when the session stops; passwords, OTPs, and payment
details are never stored in Convex and are never typed by the agent. Checkout,
payments, and placing orders are refused. This uses the existing
`FIRECRAWL_API_KEY` hackathon credential.

### 2026-09-16 - Family inbox documents, actions, and model tiers
Family inbox now classifies incoming vs outgoing mail, extracts merchant/amount/period,
and uses Firecrawl Parse/scrape for public PDF URLs. Password-protected PDFs keep an
email-body hint instead of a stored password. Processing posts a heartbeat in the
shared family chat. Suggested actions such as unsubscribe require explicit confirmation
and do not send mail. Owners can set Low/Med/High/Ultra chat models (default Med) and
see token usage by model. Mobile Family inbox keeps Back and bottom navigation. Native
overlapping family-switcher controls were replaced with button chips.

### 2026-09-16 - Family admin, larger PDFs, and room memory
Owners open Family admin from the rail avatar, mobile settings, or sidebar. They can
create up to 3 owned families. Chat PDFs upload up to 50 MB (Convex URL uploads are not
the 20 MB HTTP-action cap; images stay at 20 MB) and are parsed with Firecrawl.
The mobile composer exposes Camera. Saathi jobs are seeded from recent room chat and
shared-file notes so questions about a just-shared GIF or PDF can see it.

### 2026-09-16 - 8d7df4b
Added manual Gmail refresh, reliable Gmail PDF attachment reads, dual-currency
receipt extraction, owner-visible family usage, OTP resend, persistent sessions,
and write-contention fixes for concurrent Gmail sync (`convex/gmail.ts`,
`convex/gmailData.ts`, `convex/inboxWorkflow.ts`, `src/LiveWorkspace.tsx`).

### 2026-09-17 - 16e6743
Simplified the workspace around conversations, unified text Pi and GPT-Live on
one typed capability registry, and added deterministic handlers for multilingual
settings, memory, family data, web research, image generation, and computer use.
Improved voice handoffs and made Gmail attachment processing resilient
(`convex/lib/assistantCapabilities.ts`, `convex/agentWorker.ts`,
`convex/conversationActions.ts`, `src/useLiveVoice.ts`).

### 2026-09-17 - 4e5c0ee
Integrated TypeSafe/Jev as a multilingual pre-turn decision sidecar and private
owner inspector, then added a 36-case English, Hindi/Hinglish, and Marathi memory
benchmark covering store, recall, update, delete, scope, sensitivity, and
durability. Image-provider errors now return safe, actionable messages
(`convex/lib/jev.ts`, `convex/jev.ts`,
`convex/lib/jev.memory.benchmark.test.ts`, `convex/lib/imageGeneration.ts`).

### 2026-09-17 - f3d4357
Compared direct Pi and Jev-assisted paths over 468 captured Luna responses with
identical 15-tool and 200-tool conditions. The evidence did not support global
Jev promotion: 200-tool accuracy held at 91.5%, but pre-turn routing was 10.2%
slower at p95 and only 5.7% cheaper. Removed tool-list narrowing and per-tool Jev
gates from text and voice while retaining pre-turn guidance and deterministic
authorization (`scripts/jev-pi-e2e-benchmark.mjs`, `convex/agentWorker.ts`,
`src/useLiveVoice.ts`, `src/LiveWorkspace.tsx`).

### 2026-09-18 - Jev product slices
Implemented Jev as bounded product assistance rather than a per-tool gate.
Multilingual memory triage now detects recall, explicit writes, corrections,
removals, relevance, and prohibited secrets; its guidance is ephemeral while
deterministic handlers retain authorization, confirmation, scope, and secret
enforcement. AgentMail artifacts receive advisory asynchronous classification
and outcome telemetry after extraction without delaying inbox readiness. Added
shadow-only large-catalog routing across seven stable product bundles with
fail-open thresholds and authorization intersection; Saathi's current 14-tool
catalog still goes directly to Pi with the full tool set. No live routing was
promoted to tool-list narrowing. A production-contract memory benchmark then
passed all 36 English, Hindi/Hinglish, and Marathi cases at an estimated
$0.00215 for the run (`convex/lib/memoryTriage.ts`, `convex/conversationActions.ts`,
`convex/lib/inboxClassification.ts`, `convex/lib/toolBundleRouting.ts`,
`convex/agentWorker.ts`).

### 2026-09-18 - Saathi reply latency
Removed the blocking Jev pre-turn call from the current small catalog so Pi
starts immediately. Memory triage still runs only for memory candidates, and
large-catalog bundle routing stays pre-turn and shadow-only. After a successful
small-catalog reply, 10% of turns schedule an asynchronous Jev shadow decision
for product analytics without applying that guidance to the user reply
(`convex/agentWorker.ts`, `convex/agents.ts`).

### 2026-09-21 - 2f7ef31
Hardened room grants, invitation roles, Gmail promotion ownership, and Firecrawl
browser targets. Added opt-in Gmail fan-out through owner-created family aliases,
then consolidated delivery around an installable PWA with a complete manifest
and icon set (`convex/invitations.ts`, `convex/gmailData.ts`,
`convex/lib/familyAlias.ts`, `convex/lib/firecrawlInteract.ts`, `vite.config.ts`).

Added controlled access and installation onboarding, configured superadmin
management, and made generated images expandable in a lightbox
(`convex/admin.ts`, `src/AdminDashboard.tsx`, `src/PwaInstallPrompt.tsx`,
`src/LiveWorkspace.tsx`). Added superadmin AI usage reporting split by family,
service, platform-funded versus family BYOK spend, and separate GPT-Live and
delegated Luna work. Voice delegation and post-call summaries now use
`gpt-5.6-luna` (`convex/liveVoice.ts`, `convex/lib/usageCosts.ts`).

Made PDF reading bounded and actionable: Firecrawl gets a 120-second parse
timeout, deterministic failures do not auto-retry, transient failures remain
manually retryable, and duplicate reprocessing is rejected while work is active
(`convex/lib/firecrawlParse.ts`, `convex/inboxWorkflow.ts`, `convex/inbox.ts`,
`src/LiveWorkspace.tsx`).

### 2026-09-21 - 32780c2
Added provider-aware AI controls and trusted conversation actions, then removed
the food-budget feature to keep the product focused on family coordination.
Introduced per-family inbox notifications with safer email rendering and rebuilt
the guided preview and workspace as a compact agent control surface
(`convex/lib/conversationUi.ts`, `convex/email.ts`, `src/PreviewWorkspace.tsx`,
`src/WorkspaceModern.css`).

### 2026-09-22 - f2cd116
Turned the preview into a seven-step interactive onboarding journey and
propagated a Manrope-based luminous design system across access, workspace,
voice, inbox, settings, PWA, and admin surfaces. Responsive spacing, mobile
navigation, family switching, account controls, icon actions, and the desktop
composer were refined for 44–48px targets and clearer hierarchy
(`DESIGN.md`, `src/PreviewWorkspace.tsx`, `src/LiveWorkspace.tsx`,
`src/WorkspaceModern.css`).

### 2026-09-22 - 41e4d5b
Expanded email intelligence with typed categories and subcategories for bills,
school, travel, appointments, banking, subscriptions, household mail, receipts,
and security messages. Added field-aware extraction recovery, a branded OTP
email, dynamic privacy-safe family member profiles, pre-paint chat positioning,
accessible profile controls, structured Markdown voice results, and a darker
responsive voice surface (`convex/lib/emailTaxonomy.ts`,
`convex/lib/otpEmail.ts`, `convex/spaces.ts`, `src/LiveWorkspace.tsx`,
`src/VoiceBlob.tsx`).

### 2026-09-22 - e572666
Added an owner-only, per-family background recategorization workflow. It scans
inbox items in durable five-item batches, reuses the canonical extraction path,
persists progress for status and failed-job resume, and skips confirmed,
dismissed, or newly reviewed records without duplicating chat heartbeats or
suggested actions (`convex/recategorization.ts`, `convex/schema.ts`,
`convex/recategorization.test.ts`).
