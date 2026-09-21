# Saathi application flow

> Descriptive map of the running React + Convex application. Product intent lives in [PRODUCT.md](./PRODUCT.md). This document traces how a request actually moves through the UI, Convex functions, and external providers.

**Stack:** React 19 + Vite SPA · Convex (system of record, authz, realtime) · Convex Auth email OTP · AgentMail · OpenRouter · OpenAI · Firecrawl · Composio Gmail

Convex is the authorization boundary and durable truth. Provider responses are normalized into Convex records; provider state is never canonical. Families are isolated tenants: membership, rooms, inbox, usage, and model context never cross a space.

---

## Whole-application flow

```
Browser SPA (React / Vite)
        │
        ├── Guided preview ── seeded demo only ── no account, no live data
        │
        └── Live workspace (needs VITE_CONVEX_URL)
                │
                Email OTP ── Convex Auth ── AgentMail delivers code
                │
                users.ensureCurrent → username → space (create or accept invite)
                │
                LiveFamilyShell  (active space is the entire authz scope)
                │
     ┌──────────┼──────────┬──────────┬──────────┐
     │          │          │          │          │
   Chats     Updates     Files     Family      Voice
     │          │          │          │          │
     ▼          ▼          ▼          ▼          ▼
 messages   inbox.list  attachments  settings  liveVoice
   .post    confirmAction  storage   Gmail     GPT-Live
     │          ▲          │       invites     WebRTC
     ▼          │          ▼       budget        │
 agentJobs   AgentMail   photo/doc   BYOK        ▼
 agentWorker  webhook    readers    model tier  tools +
     │          │                               computer-use
     ▼          ▼                                  │
 OpenRouter   workflow                             ▼
  + tools     Firecrawl parse                   one room
  Firecrawl   OpenAI extract                    summary
  Muse        suggested actions
     │          │
     └──── human confirmation required for send / unsubscribe / pay / delete / invite ────┘
```

HTTP surface (`convex/http.ts`): Convex Auth routes, `POST /agentmail/webhook`, `POST /composio/webhook`, Firecrawl component under `/firecrawl/`, then static SPA hosting.

---

## 1. Entry

```
Landing (mode chooser)
├── Guided preview  → PreviewWorkspace (seeded demo, no account, no live data)
└── Live workspace  → requires VITE_CONVEX_URL
                      └── ConvexAuthProvider → email OTP → LiveWorkspace
```

Preview and live never mix. Missing `VITE_CONVEX_URL` disables live mode rather than substituting demo data. An authenticated member can leave live for preview without signing out.

---

## 2. Live onboarding

1. **Email OTP** — `saath-email` Convex Auth provider. Six-digit code, 10-minute expiry, rate-limited. AgentMail sends the code from `AGENTMAIL_AUTH_INBOX_ID`.
2. **Profile** — `users.ensureCurrent` then `users.setUsername` (unique handle).
3. **Family** — create a space (`spaces.create`, owner cap 3) or accept an email invitation (`invitations.accept`, same address, 7-day expiry).
4. **Shell** — `LiveFamilyShell` loads memberships, rooms, inbox, files, Gmail connections. A private **My Saathi** room is ensured per member.

Identity: Convex Auth `users` table (extended with `displayName`, `username`, `preferredLanguage`, `preferredImageStyle`). Ownership: `lib/authz.ts` — `requireUser` → `requireSpacePermission` (active membership; owner-only for manage) → `requireRoomPermission` (explicit `roomMembers` grant; space owner does **not** bypass a missing room grant). Private inbox items stay with `privateOwnerId`.

---

## 3. Data model (tenant graph)

```
users ──< memberships >── spaces
                             │
                             ├── rooms ──< roomMembers >── users
                             │     └── messages, attachments, generatedImages
                             │     └── agents ── agentJobs / agentMessages / agentMemory / agentEpisodes
                             ├── inboxItems (AgentMail + shared Gmail)
                             ├── gmailConnections (per user, private until shared)
                             ├── invitations, providerKeys, familyBudgets / familySpend
                             └── usageLedger, auditEvents, jevDecisions
```

- **Space** owns the AgentMail inbox, model tier, BYOK keys, usage, and audit trail.
- **Rooms:** `private` (one member + Saathi), `shared` (family), `case` (selected members). Assistant mode is `automatic` | `mention` | `off`.
- **Inbox items** classify as bills / school / travel / subscriptions / home / receipts / bank / needs_review. Visibility is `private` | `room` | `space`.
- Languages stored on the message: `en` | `hi` | `mr`.

---

## 4. Workspace surfaces

Desktop: nav rail · conversation list · active conversation · settings/context panel. Mobile: one focused pane + bottom nav.

| Pane | What it shows | Primary Convex reads |
| --- | --- | --- |
| Chats | My Saathi + family rooms | `rooms.list`, `rooms.messages` |
| Updates | Family inbox, suggested actions | `inbox.list` |
| Files | Space attachments | `attachments.forSpace` |
| Family | Language, Gmail, food budget, inbox address, model tier, BYOK, invites | `users.current`, `gmailData.mine`, `budget.food`, `spaces.*`, `invitations.list` |

Owners can open Jev debug. `jev.canViewBenchmarks` gates the private benchmark report (server-side admin check; the client never embeds an admin email).

---

## 5. Core flows

### A. Conversation → Saathi

```
LiveRoom composer
  → messages.post (room post_message, idempotency, rate limit)
  → insert messages
  → if assistantMode ≠ off: queue agentJobs, schedule agentWorker.run
  → Pi (Node 22) against OpenRouter (space model tier / BYOK)
  → Jev may route tools / memory triage (Typesafe, optional)
  → tools: search_public_web (Firecrawl), use_computer (Firecrawl Interact),
           generate_image (Muse), conversation actions (language, budget,
           model tier, memory, inbox/file search)
  → transcript persisted on agentMessages; reply written as assistant message
```

Saathi **cannot** send email, unsubscribe, pay, delete, or invite. Those stay on confirmable Saathi mutations. Chat attachments go `attachments.generateUploadUrl` → Convex storage → `attachments.submit` → photo/document read actions.

### B. Family inbox (AgentMail)

```
External mail → family AgentMail address
  → POST /agentmail/webhook
  → email.onMessageReceived (map inbox → space, dedupe message id)
  → insert inboxItems (category needs_review, status received)
  → workflow processInboxItem:
       markProcessing → Firecrawl parse documents → OpenAI extract
       → applyExtraction → Jev inbox classification telemetry
  → realtime inbox.list
  → member confirmAction / dismissAction / reprocess
```

Forwarded personal mail stays private until explicitly shared. Suggested actions never execute without confirmation.

### C. Personal Gmail (Composio)

```
Family settings → gmail.beginConnection → Composio OAuth redirect
  → gmail.confirmConnection (register trigger GMAIL_NEW_GMAIL_MESSAGE)
  → POST /composio/webhook or gmail.checkNow / backfill
  → gmail.processIncoming (Jev decide useful vs ignore)
  → private inbox item / pending money in My Saathi
  → gmailData.shareWithFamily (explicit share into family scope)
```

Connected accounts are per-member. Other family members cannot see another person's Gmail connections.

### D. Live voice

```
LiveRoom mic
  → liveVoice.startSession (WebRTC SDP ↔ OpenAI GPT-Live)
  → liveVoiceSessions row
  → tools: web search, use_computer, generate_image, conversation actions
  → optional voiceBrowserSessions (Firecrawl computer-use, live view,
     never stores passwords)
  → liveVoice.finishSession → one saved post-call summary on the room
```

### E. Invitations and multi-family

Owner `invitations.createAndSend` emails a token. Invitee signs in with that address, `invitations.accept` creates membership + room grants. The family switcher changes the entire authorization scope, not a client filter.

---

## 6. External edges

| Provider | Role | Env |
| --- | --- | --- |
| AgentMail | OTP delivery + family inbox + inbound webhook | `AGENTMAIL_API_KEY`, `AGENTMAIL_AUTH_INBOX_ID` |
| OpenRouter | Saathi chat (DeepSeek / Luna / Grok / Sol by tier) | `OPENROUTER_API_KEY` or space BYOK |
| OpenAI | Inbox extraction, GPT-Live voice | `OPENAI_API_KEY` or space BYOK |
| Firecrawl | Web search, document parse, computer-use browser | `FIRECRAWL_API_KEY` |
| Composio | Gmail OAuth, triggers, message fetch | `COMPOSIO_API_KEY`, `COMPOSIO_WEBHOOK_SECRET` |
| Typesafe (optional) | Jev turn / bundle / memory / email decisions | `TYPESAFE_API_KEY` |

Convex components: `@convex-dev/auth`, `@convex-dev/rate-limiter`, `@convex-dev/workflow`, `@convex-dev/static-hosting`, `@agentmail/convex`, `@firecrawl/firecrawl-convex`.

---

## 7. Public vs internal (attack surface)

**Client-reachable (selected):** `users.*`, `spaces.*`, `rooms.list|ensurePersonal|messages`, `messages.post`, `inbox.list|confirmAction|dismissAction|reprocess`, `agents.send|forRoom`, `attachments.*` (public), `gmail.beginConnection|confirmConnection|checkNow`, `gmailData.mine|pendingForRoom|shareWithFamily`, `invitations.list|createAndSend|revoke|accept`, `liveVoice.startSession|searchPublicWeb|useComputer|finishSession|…`, `images.forRoom|createFromVoice`, `budget.*`, `mentions.candidates`, `conversationActions.execute`, `jev.recent|evaluate|canViewBenchmarks|benchmarkReport`.

**Internal only:** AgentMail ingest, inbox workflow steps, `agentWorker.run`, Gmail process/backfill, voice-browser controller, photo/document readers, Jev claim/complete, provider-key resolve.

Rate limits sit on OTP, message post, Saathi mention, agent prompt, and live voice.
