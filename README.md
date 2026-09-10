# Saath

Saath is a multilingual family operations inbox and shared messenger. It brings household email, conversations, translations, decisions, and follow-ups into one authorized realtime workspace with Saathi as an AI participant.

The canonical product direction, MVP boundary, security model, and acceptance criteria live in [PRODUCT.md](./PRODUCT.md).

## Development

```sh
npm install
npm run dev
```

The interface runs in an interactive preview mode when `VITE_CONVEX_URL` is absent. To connect the backend, create or link a Convex development deployment and run:

```sh
npm run dev:backend
```

Follow [convex/README.md](./convex/README.md) for the server-side variable checklist and to configure email OTP, AgentMail, Firecrawl, and static hosting. Provider secrets belong in Convex deployment environment variables, not browser-visible Vite variables.

Run static checks with:

```sh
npm run lint
npm test
npm run build
```

Convex Node actions target Node 22 (see `.nvmrc`). The current implementation includes the responsive family inbox prototype, email OTP flow, multi-family switching, translation/original views, extracted facts, guarded reply interaction, 30-second family voice notes, Convex schema and authorization policies, initial AgentMail ingestion, and a durable room-scoped Pi agent runtime backed by OpenRouter DeepSeek V4.1 Flash.
