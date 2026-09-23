# Saathi

Saathi is a multilingual family operations inbox and shared messenger. It brings household email, conversations, translations, decisions, and follow-ups into one authorized realtime workspace with Saathi as an AI participant.

The product thesis, provider feature map, architecture summary, and chronological build record live in [hackathon.md](./hackathon.md). The request and trust-boundary map lives in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Development

```sh
npm install
npm run dev
```

The web app is a PWA: Chrome on Android can install it from the hosted site (`Add to Home screen`). A Capacitor Android shell can wrap the same build later.

The landing screen offers two explicit experiences. **Guided preview** replays seeded sample content without an account or personal data. **Live workspace** uses Convex Auth email OTP and reads and writes only authorized Convex family data. Live mode is disabled when `VITE_CONVEX_URL` is absent; there is no fake OTP or local-data fallback.

To connect the backend, create or link a Convex development deployment and run:

```sh
npm run dev:backend
```

Follow [convex/README.md](./convex/README.md) for the server-side variable checklist and to configure email OTP, AgentMail, Firecrawl, optional Composio Gmail ingestion, and static hosting. Provider secrets belong in Convex deployment environment variables, not browser-visible Vite variables.

## Inbox recategorization

An authenticated family **owner** can start a bounded re-extraction of one selected family space; there is intentionally no global or unauthenticated command. Invoke it from an authenticated Convex client:

```ts
const jobId = await convex.mutation(api.recategorization.startForSpace, { spaceId });
const progress = useQuery(api.recategorization.status, { jobId });
```

The durable workflow processes five inbox items per batch, serially (one active job per space), with a 250 ms pause between items. `progress.total` is `null` while discovery is still in progress, then equals the final discovered count. Owners can resume only a failed job with `api.recategorization.resume({ jobId })`.

Recategorization reuses the normal document parsing and extraction actions but changes only machine-extracted taxonomy fields. It never creates another heartbeat, suggested action, usage record, or telemetry decision. Any item with a confirmed/dismissed action, or reviewed after the job started, is skipped and its reviewed fields are retained.

## Self-hosting

1. Install dependencies and link a Convex deployment.
2. Configure Convex Auth and AgentMail for email OTP.
3. Set `BYOK_ENCRYPTION_KEY` and `SUPERADMIN_EMAILS` in the Convex deployment. Configure `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, and `TYPESAFE_API_KEY` when offering administrator-approved managed access; family owners can instead add an OpenRouter key during onboarding.
4. Run the frontend and backend, sign in with a superadmin email, and open **Access** to review accounts that requested deployment-funded AI access.

New accounts can create a family and add a family-scoped OpenRouter key immediately. BYOK families use that key and the family's selected model for structured routing and safety decisions. Accounts without an OpenRouter key remain in the access-request screen until a superadmin approves managed access; managed decision workloads use the deployment's TypeSafe key. Chrome shows the in-app install action first when the browser reports that the PWA is installable.

Run static checks with:

```sh
npm run lint
npm test
npm run build
```

Convex Node actions target Node 22 (see `.nvmrc`). The current implementation includes a responsive conversation-first family workspace, email OTP flow, email-bound family invitations, multi-family switching, explicitly member-only **My Saathi** rooms, original-plus-translation cards, decision context, Firecrawl and OpenRouter web-grounded responses, explicit Firecrawl Interact computer-use with a live browser view and per-person cookie profiles (passwords stay out of Saathi storage), full-screen GPT-Live WebRTC conversations with audio-reactive visuals and a single saved post-call summary, multiple private Gmail connections per member through Composio Sessions, explicitly requested Muse Image generation stored in Convex, Convex schema and authorization policies, initial AgentMail ingestion with Firecrawl document parsing, confirmable family-inbox actions, owner model tiers (default medium Luna), token usage for owners, and a durable room-scoped Pi agent runtime.
