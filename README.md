# Saath

Saath is a multilingual family operations inbox and shared messenger. It brings household email, conversations, translations, decisions, and follow-ups into one authorized realtime workspace with Saathi as an AI participant.

The canonical product direction, MVP boundary, security model, and acceptance criteria live in [PRODUCT.md](./PRODUCT.md).

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

Run static checks with:

```sh
npm run lint
npm test
npm run build
```

Convex Node actions target Node 22 (see `.nvmrc`). The current implementation includes a responsive conversation-first family workspace, email OTP flow, email-bound family invitations, multi-family switching, explicitly member-only **My Saathi** rooms, original-plus-translation cards, decision context, Firecrawl and OpenRouter web-grounded responses, explicit Firecrawl Interact computer-use with a live browser view and per-person cookie profiles (passwords stay out of Saathi storage), full-screen GPT-Live WebRTC conversations with audio-reactive visuals and a single saved post-call summary, multiple private Gmail connections per member through Composio Sessions, explicitly requested Muse Image generation stored in Convex, Convex schema and authorization policies, initial AgentMail ingestion with Firecrawl document parsing, confirmable family-inbox actions, owner model tiers (default medium Luna), token usage for owners, and a durable room-scoped Pi agent runtime.
