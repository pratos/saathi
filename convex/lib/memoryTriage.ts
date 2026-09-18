import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";
import { MULTILINGUAL_INTENT_GUIDANCE } from "./jev.js";

export const MEMORY_OPERATIONS = {
  none: "No memory operation is requested, including incidental, quoted, hypothetical, or negated memory language.",
  recall: "Retrieve retained information without changing it.",
  store: "Retain new information that does not replace an existing memory.",
  merge: "Correct, replace, or combine information with an existing memory.",
  remove: "Forget or delete retained information.",
  relevance: "Judge whether retained information is useful for the current request without changing it.",
} as const;

export const MEMORY_CATEGORIES = {
  profile: "A stable, non-sensitive fact about a person or household.",
  preference: "A personal or household preference.",
  relationship: "A non-sensitive relationship between people or within a household.",
  household_rule: "A durable household rule, responsibility, or routine.",
  plan: "A dated plan, promise, appointment, or commitment that may expire.",
  episode: "The outcome of a past conversation, decision, or completed activity.",
  temporary: "Information useful only for the current turn or short-lived task.",
  excluded_sensitive: "A credential, OTP, authentication secret, payment credential, exact financial account or government identifier, or similarly prohibited secret.",
} as const;

export const MEMORY_SCOPES = {
  person: "Private memory for only the requesting person.",
  family: "Shared memory for the requesting person's family.",
  current_room: "Memory limited to the currently authorized conversation.",
  unspecified: "The person did not clearly request a scope.",
} as const;

export type MemoryOperation = keyof typeof MEMORY_OPERATIONS;
export type MemoryCategory = keyof typeof MEMORY_CATEGORIES;
export type MemoryScope = keyof typeof MEMORY_SCOPES;
export type MutableMemoryOperation = Extract<MemoryOperation, "store" | "merge" | "remove">;

type ChoiceSignal<T extends string> = {
  value: T;
  confidence: number;
  probabilities: Record<T, number>;
};

export type MemorySemanticDecision = {
  /** Kept byte-for-byte as supplied so later text and voice projections do not lose language or code-switching. */
  originalText: string;
  operation: ChoiceSignal<MemoryOperation>;
  category: ChoiceSignal<MemoryCategory>;
  requestedScope: ChoiceSignal<MemoryScope>;
  explicitWrite: number;
  explicitRemove: number;
  sensitive: number;
  relevance: number;
  durability: number;
  model: string | null;
  inputTokens: number;
  latencyMs: number;
  status: "classified" | "unavailable";
};

export type MemoryPolicyContext = {
  authenticated: boolean;
  activeFamilyMember: boolean;
  canPostToRoom: boolean;
  roomType: "private" | "shared" | "case";
  requesterOwnsPrivateRoom: boolean;
  /** Must come from a deterministic user action or confirmation flow, never from the classifier. */
  confirmedOperation: MutableMemoryOperation | null;
};

export type EffectiveMemoryDecision =
  | { action: "none"; reason: "classifier_unavailable" | "uncertain" | "no_memory_intent" | "temporary_context" }
  | { action: "reject"; reason: "unauthenticated" | "unauthorized_access" | "unauthorized_scope" | "sensitive_data" }
  | { action: "confirm"; operation: MutableMemoryOperation; scope: "person" | "family"; reason: "mutation_requires_confirmation" }
  | { action: "recall" | "relevance"; scope: "person" | "family"; category: MemoryCategory }
  | { action: "store" | "merge"; scope: "person" | "family"; category: Exclude<MemoryCategory, "excluded_sensitive" | "temporary"> }
  | { action: "remove"; scope: "person" | "family" };

const MIN_CHOICE_CONFIDENCE = 0.72;
const MIN_EXPLICIT_WRITE = 0.8;
const MIN_EXPLICIT_REMOVE = 0.85;
const MAX_SENSITIVE_CONFIDENCE = 0.2;

export async function decideMemory(apiKey: string, input: {
  originalText: string;
  languageHint?: "en" | "hi" | "mr" | "unknown";
  existingCandidates?: Array<{ category: MemoryCategory; scope: MemoryScope; originalText: string }>;
}): Promise<MemorySemanticDecision> {
  const startedAt = Date.now();
  const response = await new TypeSafeClient({ apiKey, logLevel: "error", timeout: 10_000 }).systemOne({
    state: {
      latest_user_request: input.originalText.slice(0, 12_000),
      language_hint: input.languageHint ?? "unknown",
      existing_candidates: (input.existingCandidates ?? []).slice(0, 20).map(candidate => ({
        ...candidate,
        originalText: candidate.originalText.slice(0, 1_200),
      })),
      interpretation_policy: MULTILINGUAL_INTENT_GUIDANCE,
      memory_policy: {
        explicit_writes_only: "A write requires a direct, present request to remember, save, change, or correct information.",
        no_inference: "Incidental, quoted, hypothetical, negated, or merely useful information is not a write request.",
        sensitive: "Credentials, OTPs, authentication secrets, payment credentials, and exact financial account or government identifiers must never be retained.",
        authorization: "Classify requested scope only. Application code determines authorization and confirmation.",
      },
    },
    questions: {
      operation: choice({
        question: "Which memory operation does `latest_user_request` explicitly request now?",
        focus: "Apply the interpretation and memory policies. Use relevance only when asked to judge or use candidate memory for this request. Existing candidates distinguish merge from store.",
      }, MEMORY_OPERATIONS),
      category: choice({
        question: "Which compact memory category best describes the information involved?",
        focus: "Use excluded_sensitive whenever durable retention is prohibited, even when storage is explicitly requested.",
      }, MEMORY_CATEGORIES),
      requested_scope: choice({
        question: "What memory scope does the person explicitly request?",
        focus: "Classify only expressed person, family, or current-conversation scope. Do not infer authorization.",
      }, MEMORY_SCOPES),
      explicit_write: noul("Does the person directly and currently ask Saathi to store or merge memory?", {
        true: "A direct present-tense store, correction, replacement, or merge request.",
        false: "Ordinary, incidental, quoted, hypothetical, negated, recall-only, remove-only, or relevance-only language.",
      }),
      explicit_remove: noul("Does the person directly and currently ask Saathi to remove retained memory?"),
      sensitive: noul("Would retaining the information violate `memory_policy.sensitive`?"),
      relevance: score("How relevant is candidate retained information to answering the current request?", [
        "Not relevant.", "Weakly related.", "Possibly useful.", "Directly useful.", "Required to answer correctly.",
      ]),
      durability: score("How durable should this information be if deterministic policy allowed retention?", [
        "Must not be retained.", "Current turn only.", "Temporary until a date or event.", "Useful until changed.", "Stable until changed or removed.",
      ]),
    },
  });

  return {
    originalText: input.originalText,
    operation: signal(response.answers.operation),
    category: signal(response.answers.category),
    requestedScope: signal(response.answers.requested_scope),
    explicitWrite: response.answers.explicit_write.noul,
    explicitRemove: response.answers.explicit_remove.noul,
    sensitive: response.answers.sensitive.noul,
    relevance: response.answers.relevance.score,
    durability: response.answers.durability.score,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    latencyMs: Date.now() - startedAt,
    status: "classified",
  };
}

export async function safelyDecideMemory(
  apiKey: string,
  input: Parameters<typeof decideMemory>[1],
  classify: typeof decideMemory = decideMemory,
): Promise<MemorySemanticDecision> {
  try {
    return await classify(apiKey, input);
  } catch {
    return unavailableMemoryDecision(input.originalText);
  }
}

export function applyMemoryPolicy(
  decision: MemorySemanticDecision,
  context: MemoryPolicyContext,
): EffectiveMemoryDecision {
  if (!context.authenticated) return { action: "reject", reason: "unauthenticated" };
  if (!context.activeFamilyMember || !context.canPostToRoom) return { action: "reject", reason: "unauthorized_access" };
  if (decision.status === "unavailable") return { action: "none", reason: "classifier_unavailable" };
  const confidentRemoval = decision.operation.value === "remove" && isConfident(decision.operation);
  if (!confidentRemoval && (containsProhibitedSecret(decision.originalText)
    || decision.category.value === "excluded_sensitive"
    || decision.sensitive > MAX_SENSITIVE_CONFIDENCE)) {
    return { action: "reject", reason: "sensitive_data" };
  }
  if (!isConfident(decision.operation) || !isConfident(decision.category) || !isConfident(decision.requestedScope)) {
    return { action: "none", reason: "uncertain" };
  }
  if (decision.operation.value === "none") return { action: "none", reason: "no_memory_intent" };
  if (decision.operation.value !== "remove" && decision.category.value === "temporary") {
    return { action: "none", reason: "temporary_context" };
  }

  const scope = authorizedScope(decision.requestedScope.value, context);
  if (!scope) return { action: "reject", reason: "unauthorized_scope" };
  const operation = decision.operation.value;
  if (operation === "recall" || operation === "relevance") {
    return { action: operation, scope, category: decision.category.value };
  }

  const intentIsExplicit = operation === "remove"
    ? decision.explicitRemove >= MIN_EXPLICIT_REMOVE
    : decision.explicitWrite >= MIN_EXPLICIT_WRITE;
  if (!intentIsExplicit) return { action: "none", reason: "uncertain" };
  if (context.confirmedOperation !== operation) {
    return { action: "confirm", operation, scope, reason: "mutation_requires_confirmation" };
  }
  if (operation === "remove") return { action: operation, scope };
  if (decision.category.value === "excluded_sensitive" || decision.category.value === "temporary") {
    return { action: "none", reason: "uncertain" };
  }
  return { action: operation, scope, category: decision.category.value };
}

export function shouldTriageMemoryRequest(text: string) {
  return /\b(?:remember|recall|forget|forgot|memory|memories|save this|saved fact|yaad|bhool)\b|(?:याद|भूल|लक्षात|विसर|आठव)/iu.test(text);
}

export function memoryDecisionGuidance(decision: MemorySemanticDecision | null) {
  if (!decision || decision.status === "unavailable") return "";
  const operation = decision.operation.value;
  const confidentOperation = isConfident(decision.operation);
  if (containsProhibitedSecret(decision.originalText)
    || decision.category.value === "excluded_sensitive"
    || decision.sensitive > MAX_SENSITIVE_CONFIDENCE) {
    return operation === "remove" && confidentOperation
      ? "Jev memory sidecar: the person is asking to remove sensitive retained data. Allow an exact authorized deletion, but do not repeat the sensitive value."
      : "Jev memory sidecar: do not store or repeat the sensitive value. Explain briefly that Saathi cannot retain secrets.";
  }
  if (!confidentOperation) return "";
  if ((operation === "store" || operation === "merge") && decision.explicitWrite >= MIN_EXPLICIT_WRITE) {
    return `Jev memory sidecar: this is an explicit ${operation} request in ${decision.requestedScope.value} scope. Use the normal authorized memory tool; do not widen its scope.`;
  }
  if (operation === "remove" && decision.explicitRemove >= MIN_EXPLICIT_REMOVE) {
    return "Jev memory sidecar: this is an explicit removal request. Delete only the exact authorized memory target; ask a focused question if the target is ambiguous.";
  }
  if (operation === "recall" || operation === "relevance") {
    return `Jev memory sidecar: this is a ${operation} request, not permission to write or delete memory.`;
  }
  return "";
}

export function containsProhibitedSecret(text: string) {
  const normalized = text.normalize("NFKC");
  const secretLabel = /\b(?:otp|one[ -]?time password|password|passcode|(?:atm|upi|card) pin|pin (?:code|is)|cvv|api[ _-]?key|access token|private key|bank account|account number|aadhaar|aadhar|pan number)\b|(?:ओटीपी|पासवर्ड|पिन|खाता क्रमांक|अकाउंट नंबर|आधार क्रमांक|खाते क्रमांक)/iu;
  const credentialShape = /\b(?:sk|pk|api|token)[_-][A-Za-z0-9_-]{12,}\b/u;
  return secretLabel.test(normalized) || credentialShape.test(normalized);
}

function authorizedScope(scope: MemoryScope, context: MemoryPolicyContext): "person" | "family" | null {
  const roomScope = context.roomType === "private" ? "person" : "family";
  const requested = scope === "current_room" || scope === "unspecified" ? roomScope : scope;
  if (requested === "person") {
    return context.roomType === "private" && context.requesterOwnsPrivateRoom ? "person" : null;
  }
  return context.roomType !== "private" ? "family" : null;
}

function isConfident<T extends string>(value: ChoiceSignal<T>) {
  return Number.isFinite(value.confidence) && value.confidence >= MIN_CHOICE_CONFIDENCE;
}

function signal<T extends string>(answer: { choice: T; confidence: number; probabilities: Record<T, number> }): ChoiceSignal<T> {
  return { value: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities };
}

function unavailableMemoryDecision(originalText: string): MemorySemanticDecision {
  return {
    originalText,
    operation: emptySignal<MemoryOperation>("none", MEMORY_OPERATIONS),
    category: emptySignal<MemoryCategory>("temporary", MEMORY_CATEGORIES),
    requestedScope: emptySignal<MemoryScope>("unspecified", MEMORY_SCOPES),
    explicitWrite: 0,
    explicitRemove: 0,
    sensitive: 1,
    relevance: 0,
    durability: 0,
    model: null,
    inputTokens: 0,
    latencyMs: 0,
    status: "unavailable",
  };
}

function emptySignal<T extends string>(value: T, choices: Record<T, string>): ChoiceSignal<T> {
  return {
    value,
    confidence: 0,
    probabilities: Object.fromEntries(Object.keys(choices).map(key => [key, 0])) as Record<T, number>,
  };
}
