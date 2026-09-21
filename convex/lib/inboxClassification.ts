import { v } from "convex/values";
import type { DecisionCredential } from "./decisionProvider";
import { decideEmail, type JevEmailDecision } from "./jev";

const emailCategory = v.union(v.literal("bills"), v.literal("receipts"), v.literal("bank"), v.literal("ignore"));

export const inboxClassificationResultValidator = v.union(
  v.object({
    kind: v.literal("classified"),
    decision: v.object({
      category: emailCategory,
      confidence: v.number(),
      probabilities: v.record(v.string(), v.number()),
      tracksHouseholdMoney: v.number(),
      containsOtpOrLoginCode: v.number(),
      model: v.string(),
      inputTokens: v.number(),
      latencyMs: v.number(),
    }),
    disposition: v.union(
      v.literal("retained_household_candidate"),
      v.literal("retained_advisory_ignore"),
      v.literal("retained_uncertain"),
    ),
  }),
  v.object({
    kind: v.literal("unavailable"),
    reason: v.union(v.literal("not_configured"), v.literal("classification_failed")),
    model: v.literal("jev-email"),
    inputTokens: v.literal(0),
    latencyMs: v.number(),
    disposition: v.literal("retained_classification_unavailable"),
  }),
);

export type InboxClassificationDisposition =
  | "retained_household_candidate"
  | "retained_advisory_ignore"
  | "retained_uncertain"
  | "retained_classification_unavailable";

export type InboxClassificationResult =
  | {
    kind: "classified";
    decision: JevEmailDecision;
    disposition: Exclude<InboxClassificationDisposition, "retained_classification_unavailable">;
  }
  | {
    kind: "unavailable";
    reason: "not_configured" | "classification_failed";
    model: "jev-email";
    inputTokens: 0;
    latencyMs: number;
    disposition: "retained_classification_unavailable";
  };

type EmailInput = { sender: string; subject: string; text: string };
type Classifier = (credential: DecisionCredential, email: EmailInput) => Promise<JevEmailDecision>;

/** Advisory classification for already-persisted shared inbox mail. It never drops the artifact. */
export async function classifyInboxEmail(
  credential: DecisionCredential | undefined,
  email: EmailInput,
  classifier: Classifier = decideEmail,
): Promise<InboxClassificationResult> {
  const startedAt = Date.now();
  if (!credential) return unavailable("not_configured", startedAt);
  try {
    const decision = await classifier(credential, email);
    return { kind: "classified", decision, disposition: inboxDisposition(decision) };
  } catch {
    return unavailable("classification_failed", startedAt);
  }
}

export function inboxDisposition(decision: JevEmailDecision): Exclude<InboxClassificationDisposition, "retained_classification_unavailable"> {
  if (isConfidentEmailIgnore(decision)) return "retained_advisory_ignore";
  if (decision.tracksHouseholdMoney > 0.45 || (decision.category !== "ignore" && decision.confidence >= 0.65)) {
    return "retained_household_candidate";
  }
  return "retained_uncertain";
}

export function isConfidentEmailIgnore(decision: JevEmailDecision) {
  return decision.category === "ignore"
    && decision.confidence >= 0.65
    && (decision.tracksHouseholdMoney <= 0.45 || decision.containsOtpOrLoginCode >= 0.65);
}

function unavailable(reason: "not_configured" | "classification_failed", startedAt: number): InboxClassificationResult {
  return {
    kind: "unavailable",
    reason,
    model: "jev-email",
    inputTokens: 0,
    latencyMs: Date.now() - startedAt,
    disposition: "retained_classification_unavailable",
  };
}
