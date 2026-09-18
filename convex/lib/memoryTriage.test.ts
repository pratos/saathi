import { describe, expect, test } from "vitest";
import {
  applyMemoryPolicy,
  containsProhibitedSecret,
  safelyDecideMemory,
  type MemoryCategory,
  type MemoryOperation,
  type MemoryScope,
  type MemorySemanticDecision,
} from "./memoryTriage.js";

const personalContext = {
  authenticated: true,
  activeFamilyMember: true,
  canPostToRoom: true,
  roomType: "private" as const,
  requesterOwnsPrivateRoom: true,
  confirmedOperation: null,
};

describe("deterministic memory policy", () => {
  test.each([
    ["en", "Please remember that I prefer vegetarian food."],
    ["hi", "याद रखो कि मुझे शाकाहारी खाना पसंद है।"],
    ["mr", "मला शाकाहारी जेवण आवडतं, हे लक्षात ठेव."],
    ["hinglish", "Yaad rakhna, mujhe mushroom bilkul pasand nahi."],
  ])("preserves %s original text and requires confirmation before storage", (_language, originalText) => {
    const decision = classified({ originalText, operation: "store", category: "preference", scope: "person", explicitWrite: 0.96 });
    expect(decision.originalText).toBe(originalText);
    expect(applyMemoryPolicy(decision, personalContext)).toEqual({
      action: "confirm", operation: "store", scope: "person", reason: "mutation_requires_confirmation",
    });
    expect(applyMemoryPolicy(decision, { ...personalContext, confirmedOperation: "store" })).toEqual({
      action: "store", scope: "person", category: "preference",
    });
  });

  test.each([
    "I remember taking the train to Mysuru as a child.",
    "जो मैं कहूँ उसे याद मत रखना।",
    "समजा मी तुला लक्षात ठेवायला सांगितलं तर काय होईल?",
    "The email says ‘remember to enter the code’.",
  ])("does not mutate for negative or non-operative language: %s", originalText => {
    expect(applyMemoryPolicy(classified({ originalText, operation: "none", category: "temporary" }), personalContext))
      .toEqual({ action: "none", reason: "no_memory_intent" });
  });

  test("treats ambiguous store-versus-temporary content as non-mutating", () => {
    const ambiguous = classified({
      originalText: "We may eat at 8 tonight.", operation: "store", category: "temporary", explicitWrite: 0.44,
    });
    expect(applyMemoryPolicy(ambiguous, personalContext)).toEqual({ action: "none", reason: "temporary_context" });
  });

  test.each([
    "Remember my login OTP is 481921.",
    "मेरा बैंक अकाउंट नंबर 123456789012 सेव कर लो।",
    "माझा आधार क्रमांक 1234 5678 9012 लक्षात ठेव.",
    "Save API key sk_test_abcdefghijklmnopqrstuvwxyz.",
  ])("rejects sensitive content even when semantic signals say it is safe: %s", originalText => {
    expect(containsProhibitedSecret(originalText)).toBe(true);
    const guessedSafe = classified({ originalText, operation: "store", category: "profile", explicitWrite: 0.99, sensitive: 0.01 });
    expect(applyMemoryPolicy(guessedSafe, { ...personalContext, confirmedOperation: "store" }))
      .toEqual({ action: "reject", reason: "sensitive_data" });
  });

  test("prevents person and family scope escalation", () => {
    const personal = classified({ originalText: "Remember this only for me", operation: "store", scope: "person", explicitWrite: 0.95 });
    const family = classified({ originalText: "Remember this for our family", operation: "store", scope: "family", explicitWrite: 0.95 });
    const sharedContext = { ...personalContext, roomType: "shared" as const, requesterOwnsPrivateRoom: false };

    expect(applyMemoryPolicy(personal, sharedContext)).toEqual({ action: "reject", reason: "unauthorized_scope" });
    expect(applyMemoryPolicy(family, personalContext)).toEqual({ action: "reject", reason: "unauthorized_scope" });
    expect(applyMemoryPolicy(personal, { ...personalContext, requesterOwnsPrivateRoom: false }))
      .toEqual({ action: "reject", reason: "unauthorized_scope" });
  });

  test("resolves unspecified scope only to the current authorized room boundary", () => {
    const decision = classified({ originalText: "What did I ask you to remember?", operation: "recall", scope: "unspecified" });
    expect(applyMemoryPolicy(decision, personalContext)).toMatchObject({ action: "recall", scope: "person" });
    expect(applyMemoryPolicy(decision, { ...personalContext, roomType: "shared", requesterOwnsPrivateRoom: false }))
      .toMatchObject({ action: "recall", scope: "family" });
  });

  test.each(["merge", "remove"] as const)("requires matching deterministic confirmation for %s", operation => {
    const decision = classified({
      originalText: operation === "merge" ? "Change Delhi to Pune." : "Forget my saved food preference.",
      operation,
      explicitWrite: operation === "merge" ? 0.96 : 0,
      explicitRemove: operation === "remove" ? 0.96 : 0,
    });
    expect(applyMemoryPolicy(decision, { ...personalContext, confirmedOperation: "store" })).toMatchObject({
      action: "confirm", operation,
    });
    expect(applyMemoryPolicy(decision, { ...personalContext, confirmedOperation: operation })).toMatchObject({ action: operation });
  });

  test("fails closed on classifier failure and low confidence", async () => {
    const failed = await safelyDecideMemory("test-key", { originalText: "माझी माहिती लक्षात ठेव" }, async () => {
      throw new Error("Jev unavailable");
    });
    expect(failed.originalText).toBe("माझी माहिती लक्षात ठेव");
    expect(applyMemoryPolicy(failed, personalContext)).toEqual({ action: "none", reason: "classifier_unavailable" });

    const uncertain = classified({ originalText: "maybe remember this", operation: "store", operationConfidence: 0.71, explicitWrite: 0.9 });
    expect(applyMemoryPolicy(uncertain, { ...personalContext, confirmedOperation: "store" }))
      .toEqual({ action: "none", reason: "uncertain" });
  });

  test("allows authorized recall and relevance without granting mutation", () => {
    expect(applyMemoryPolicy(classified({ originalText: "What do I prefer?", operation: "recall" }), personalContext))
      .toMatchObject({ action: "recall", scope: "person" });
    expect(applyMemoryPolicy(classified({ originalText: "Is my saved preference relevant?", operation: "relevance" }), personalContext))
      .toMatchObject({ action: "relevance", scope: "person" });
  });
});

function classified(overrides: {
  originalText: string;
  operation?: MemoryOperation;
  category?: MemoryCategory;
  scope?: MemoryScope;
  operationConfidence?: number;
  explicitWrite?: number;
  explicitRemove?: number;
  sensitive?: number;
}): MemorySemanticDecision {
  const operation = overrides.operation ?? "recall";
  const category = overrides.category ?? "profile";
  const scope = overrides.scope ?? "person";
  return {
    originalText: overrides.originalText,
    operation: choiceSignal(operation, overrides.operationConfidence ?? 0.95),
    category: choiceSignal(category, 0.95),
    requestedScope: choiceSignal(scope, 0.95),
    explicitWrite: overrides.explicitWrite ?? 0,
    explicitRemove: overrides.explicitRemove ?? 0,
    sensitive: overrides.sensitive ?? 0.01,
    relevance: 4,
    durability: 4,
    model: "test",
    inputTokens: 0,
    latencyMs: 1,
    status: "classified",
  };
}

function choiceSignal<T extends string>(value: T, confidence: number) {
  return { value, confidence, probabilities: { [value]: confidence } as Record<T, number> };
}
