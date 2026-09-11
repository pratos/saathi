# Hackathon log

- **Project:** Saath
- **Event:** Convex All Gas Hackathon
- **What it does:** A multilingual family operations inbox for shared email, conversations, translations, decisions, and follow-ups.
- **Live app:** not deployed
- **Repo:** https://github.com/pratos/saathi
- **Frontend:** Convex static hosting
- **Convex deployment:** not deployed
- **Components:** @agentmail/convex, @convex-dev/rate-limiter, @convex-dev/static-hosting, @convex-dev/workflow, @firecrawl/firecrawl-convex
- **Convex features:** schema, indexes, queries, mutations, actions, HTTP actions, durable workflows, scheduled lease recovery
- **Auth:** Convex Auth
- **AI models:** deepseek/deepseek-v4.1-flash, gpt-5-mini, saaras:v3
- **Started:** 2026-09-10T11:35:28Z
- **Last updated:** 2026-09-11T04:52:28Z

## Log

### 2026-09-10 - b92bca9
Established Saath as a multilingual family operations inbox and documented the
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

### 2026-09-11 - working tree
Added a GitHub Actions release path that lints and tests before the official
Static Hosting command builds against production, deploys the Convex backend,
and atomically publishes the frontend (`.github/workflows/deploy-convex.yml`,
`convex/README.md`).
