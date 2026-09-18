# Jev product strategy

## Decision

Use Jev as a cheap semantic triage layer, not as an authorization authority and
not as a second model call around every tool execution. The strongest near-term
uses are multilingual memory intent, sensitive-data screening, and asynchronous
classification of household email and files.

Keep direct Pi as the default for Saathi's current 15-tool catalog. Consider
Jev tool-bundle routing only when the authorized catalog becomes large enough
that sending every schema materially hurts cost or latency.

## Evidence from Saathi

The current end-to-end corpus has the same 39 English, Hindi/Hinglish, and
Marathi cases repeated three times under four comparable conditions. At 200
tools, Jev pre-turn guidance matched direct Pi's 107/117 exact selections
(91.5%) and reduced measured cost by 5.7%, but increased p95 latency from 2,434
ms to 2,683 ms. At 15 tools, the Jev path fell from 106/117 to 100/117 exact.

The multilingual memory benchmark was more promising: operation and sensitive
data detection were reliable, while scope and taxonomy needed calibration.
Therefore Jev may recommend memory intent, category, sensitivity, and retention,
but deterministic code must continue to own authorization, family-versus-person
scope, writes, and deletion.

## Product uses in priority order

1. **Memory assistance:** detect explicit recall, store, update, and forget
   requests; reject secrets; suggest category and retention; confirm broad or
   destructive changes.
2. **Asynchronous household-data classification:** categorize inbox items,
   receipts, bills, files, and episodes during ingestion, outside response
   latency.
3. **Product intelligence:** record shadow decisions and eventual outcomes in
   the Jev inspector to find ambiguous requests and missing capabilities.
4. **Large-catalog bundle routing:** expose one or two broad, authorized bundles
   to Pi only after the catalog is large and a benchmark proves a material
   end-to-end win.

Do not delegate permissions, family scope, irreversible confirmation, exact
tool execution, or secret handling to Jev. Voice should not add a second Jev
round trip after GPT-Live has proposed a tool.

## How large-bundle routing would work

Bundles are stable product-owned groups, not model-generated tool names. For
example:

| Bundle | Example capabilities |
| --- | --- |
| `public_research` | public search and current facts |
| `web_operations` | browser/computer use |
| `creation` | image and document generation |
| `memory` | remember, recall, list, and forget |
| `personal_settings` | reading language and personal defaults |
| `family_settings` | family budget and model tier |
| `family_data` | authorized inbox, files, and budget reads |

The application first computes the caller's authorized tools. If the result is
small, it skips Jev. For a large catalog, one TypeSafe request chooses a primary
bundle, indicates whether a second bundle is required, detects clarification,
and scores routing risk. Application code then applies confidence thresholds,
intersects bundles with the authorized set, and falls back to the complete
authorized catalog whenever the decision is uncertain. Pi still chooses the
exact tool and all existing tool handlers re-check authorization.

```diagram
┌──────────────┐   ┌─────────────────────┐   ┌──────────────────┐
│ User request │──▶│ Deterministic auth  │──▶│ Allowed catalog  │
└──────────────┘   └─────────────────────┘   └────────┬─────────┘
                                                     │
                                  small catalog ─────┤────▶ Full allowed list
                                                     │ large catalog
                                                     ▼
                                           ┌──────────────────┐
                                           │ TypeSafe routing │
                                           └────────┬─────────┘
                                                    ▼
                                  ┌────────────────────────────────┐
                                  │ Confident: 1–2 broad bundles   │
                                  │ Uncertain/error: full fallback │
                                  └───────────────┬────────────────┘
                                                  ▼
                                      ┌─────────────────────┐
                                      │ Pi selects exact tool│
                                      └──────────┬──────────┘
                                                 ▼
                                      ┌─────────────────────┐
                                      │ Handler auth + policy│
                                      └─────────────────────┘
```

## TypeSafe primitive pseudocode

This is a proposed interface, not current production code.

```ts
import { TypeSafeClient, choice, noul, score } from "@typesafe-ai/sdk";

const BUNDLES = {
  answer_only: "No external capability is needed.",
  public_research: "Current public facts, news, and web research.",
  web_operations: "Explicitly operating a public website.",
  creation: "Creating images, documents, or other media.",
  memory: "Explicit remember, recall, update, list, or forget requests.",
  personal_settings: "Changing only the caller's own preferences.",
  family_settings: "Reading or changing owner-controlled family settings.",
  family_data: "Reading authorized family inbox items, files, or budgets.",
} as const;

const SECONDARY_BUNDLES = {
  none: "No second bundle is needed.",
  ...BUNDLES,
} as const;

type BundleName = keyof typeof BUNDLES;
type BundleDecision = {
  primary: BundleName;
  primaryConfidence: number;
  primaryProbabilities: Record<BundleName, number>;
  secondary: keyof typeof SECONDARY_BUNDLES;
  needsSecondary: number;       // noul probability from 0 to 1
  needsClarification: number;   // noul probability from 0 to 1
  routingRisk: number;          // score from 0 to 4
};

async function decideBundles(input: {
  request: string;
  recentConversation: string;
  availableBundleSummaries: string[];
}): Promise<BundleDecision> {
  const result = await new TypeSafeClient({ apiKey, timeout: 10_000 })
    .systemOne({
      state: {
        latest_user_request: input.request,
        recent_conversation: input.recentConversation,
        available_bundles: input.availableBundleSummaries,
        policy: {
          multilingual: "Resolve English, Hindi/Hinglish, and Marathi meaning before routing.",
          no_authorization: "Classify intent only; application code owns authorization.",
          no_guessing: "Do not invent a missing target, value, date, or scope.",
        },
      },
      questions: {
        primary_bundle: choice(
          "Which broad capability bundle best handles the request?",
          BUNDLES,
        ),
        needs_secondary_bundle: noul(
          "Does completing the request require a second distinct capability bundle?",
        ),
        secondary_bundle: choice(
          "Which second bundle is required, or none?",
          SECONDARY_BUNDLES,
        ),
        needs_clarification: noul(
          "Is a required target, value, date, scope, or confirmation missing?",
        ),
        routing_risk: score(
          "How risky is it to hide all capabilities outside the selected bundles?",
          [
            "0: clearly one bundle",
            "1: one bundle with minor ambiguity",
            "2: plausible neighboring bundle",
            "3: likely multi-bundle or underspecified",
            "4: unsafe to narrow",
          ],
        ),
      },
    });

  return {
    primary: result.answers.primary_bundle.choice,
    primaryConfidence: result.answers.primary_bundle.confidence,
    primaryProbabilities: result.answers.primary_bundle.probabilities,
    secondary: result.answers.secondary_bundle.choice,
    needsSecondary: result.answers.needs_secondary_bundle.noul,
    needsClarification: result.answers.needs_clarification.noul,
    routingRisk: result.answers.routing_risk.score,
  };
}

function toolsForTurn(
  authorizedTools: Tool[],
  decision: BundleDecision | null,
): Tool[] {
  if (authorizedTools.length <= 30 || !decision) return authorizedTools;

  const primaryProbability =
    decision.primaryProbabilities[decision.primary];
  const safeToNarrow =
    decision.primaryConfidence >= 0.85 &&
    primaryProbability >= 0.85 &&
    decision.needsClarification < 0.50 &&
    decision.routingRisk <= 1.25;

  if (!safeToNarrow) return authorizedTools; // fail open for availability

  const bundles = [decision.primary];
  if (
    decision.needsSecondary >= 0.70 &&
    decision.secondary !== "none" &&
    decision.secondary !== decision.primary
  ) {
    bundles.push(decision.secondary);
  }

  const selectedNames = new Set(
    bundles.flatMap(bundle => TOOL_BUNDLES[bundle]),
  );

  // Never expand permissions: this only removes tools from the authorized set.
  return authorizedTools.filter(tool => selectedNames.has(tool.name));
}

async function preparePiTurn(request: TurnRequest) {
  const authorizedTools = deterministicAuthorizedTools(request.identity);

  // Run alongside memory/context retrieval so routing latency is mostly hidden.
  const [context, decision] = await Promise.all([
    loadAuthorizedContext(request),
    authorizedTools.length > 30
      ? decideBundles(bundleInput(request, authorizedTools)).catch(() => null)
      : Promise.resolve(null),
  ]);

  return runPi({
    context,
    tools: toolsForTurn(authorizedTools, decision),
    // Pi, not Jev, selects the exact tool and arguments.
  });
}
```

## Cache and rollout constraints

- Keep the system prompt and bundle definitions versioned and stable.
- Keep tools in deterministic order. Dynamic catalogs create different prompt
  cache keys; repeated traffic within the same bundle can still reuse a stable
  bundle prefix, but cross-bundle turns may not.
- Run routing in parallel with authorized context retrieval and never add a
  second Jev call after Pi.
- Start in shadow mode and measure **bundle recall**: whether every expected
  tool remained available. Exact route accuracy alone is insufficient.
- Promote only if multilingual and multi-turn tests stay within three accuracy
  points of direct Pi, produce no authorization or safety regression, and show
  material end-to-end savings. The current benchmark targets are at least 30%
  lower p95 latency and 40% lower cost at the expanded catalog size.

Until those gates pass, direct Pi remains the production default.
