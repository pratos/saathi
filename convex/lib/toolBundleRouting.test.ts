import { describe, expect, test } from "vitest";
import { APPLICATION_ASSISTANT_TOOLS, authorizedAssistantToolNames } from "./assistantCapabilities.js";
import {
  BUNDLE_SELECTION_THRESHOLD,
  recommendToolBundles,
  shadowRoutingMetrics,
  TOOL_BUNDLES,
  type ToolBundleDecision,
} from "./toolBundleRouting.js";

const fixtureBundles = {
  public_research: { description: "Public research", tools: Array.from({ length: 6 }, (_, index) => `public_research_${index}`) },
  web_operations: { description: "Web operations", tools: Array.from({ length: 5 }, (_, index) => `web_operations_${index}`) },
  creation: { description: "Creation", tools: Array.from({ length: 5 }, (_, index) => `creation_${index}`) },
  memory: { description: "Memory", tools: Array.from({ length: 5 }, (_, index) => `memory_${index}`) },
  personal_settings: { description: "Personal settings", tools: Array.from({ length: 5 }, (_, index) => `personal_settings_${index}`) },
  family_settings: { description: "Family settings", tools: Array.from({ length: 5 }, (_, index) => `family_settings_${index}`) },
  family_data: { description: "Family data", tools: Array.from({ length: 5 }, (_, index) => `family_data_${index}`) },
} as const;
const largeCatalog = Object.values(fixtureBundles).flatMap(bundle => [...bundle.tools]);

describe("shadow tool-bundle routing policy", () => {
  test("keeps every product tool in exactly one stable broad bundle", () => {
    const bundled = Object.values(TOOL_BUNDLES).flatMap(bundle => [...bundle.tools]);
    expect(bundled.toSorted()).toEqual(APPLICATION_ASSISTANT_TOOLS.map(tool => tool.name).toSorted());
    expect(new Set(bundled).size).toBe(bundled.length);
  });

  test("starts from deterministic caller authorization before bundle intersection", () => {
    expect(authorizedAssistantToolNames("owner")).toHaveLength(APPLICATION_ASSISTANT_TOOLS.length);
    expect(APPLICATION_ASSISTANT_TOOLS.map(tool => tool.name)).not.toEqual(expect.arrayContaining(["set_food_budget", "get_food_budget"]));
    expect(authorizedAssistantToolNames("member")).not.toContain("set_model_tier");
    expect(authorizedAssistantToolNames("member")).toContain("set_reading_language");
  });

  test("gives Direct Pi the complete authorized set at and below 30 tools", () => {
    for (const count of [0, 14, 30]) {
      const authorized = largeCatalog.slice(0, count);
      const result = recommendToolBundles(authorized, malformedDecision(), fixtureBundles);
      expect(result).toMatchObject({ reason: "small_catalog", usedFullSet: true, wouldNarrow: false });
      expect(result.recommendedToolNames).toEqual(authorized);
    }
  });

  test("intersects at most two stable bundles with the already-authorized catalog", () => {
    const primary = recommendToolBundles(largeCatalog, decision(), fixtureBundles);
    expect(primary.recommendedToolNames).toEqual(fixtureBundles.public_research.tools);

    const two = recommendToolBundles(largeCatalog, decision({
      secondaryBundle: "creation",
      secondaryConfidence: 0.9,
      secondaryProbabilities: probabilities("creation", 0.9, true),
      needsSecondaryBundle: 0.8,
    }), fixtureBundles);
    expect(two.recommendedToolNames).toEqual([...fixtureBundles.public_research.tools, ...fixtureBundles.creation.tools]);
    expect(two.secondaryBundle).toBe("creation");

    const unauthorized = largeCatalog.filter(tool => tool !== "public_research_3");
    const intersected = recommendToolBundles(unauthorized, decision(), fixtureBundles);
    expect(intersected.recommendedToolNames).not.toContain("public_research_3");
  });

  test("uses the full authorized set for every fail-open condition and exact threshold boundaries", () => {
    const cases: Array<[string, unknown, string]> = [
      ["classifier error", null, "classifier_error"],
      ["malformed", malformedDecision(), "malformed_output"],
      ["missing selected probability", decision({ primaryProbabilities: {} as ToolBundleDecision["primaryProbabilities"] }), "threshold_miss"],
      ["primary confidence below", decision({ primaryConfidence: BUNDLE_SELECTION_THRESHOLD - 0.001 }), "threshold_miss"],
      ["selected probability below", decision({ primaryProbabilities: probabilities("public_research", BUNDLE_SELECTION_THRESHOLD - 0.001) }), "threshold_miss"],
      ["clarification boundary", decision({ needsClarification: 0.5 }), "clarification"],
      ["any uncertainty", decision({ uncertainty: 0.001 }), "uncertain"],
      ["risk above", decision({ risk: 1.251 }), "risk"],
      ["missing secondary", decision({ needsSecondaryBundle: 0.8, secondaryBundle: "missing" as "none" }), "missing_bundle"],
      ["prototype-looking bundle", decision({ primaryBundle: "toString" as "public_research" }), "missing_bundle"],
    ];
    for (const [label, candidate, reason] of cases) {
      const result = recommendToolBundles(largeCatalog, candidate, fixtureBundles);
      expect(result.reason, label).toBe(reason);
      expect(result.recommendedToolNames, label).toEqual(largeCatalog);
    }

    expect(recommendToolBundles(largeCatalog, decision({
      primaryConfidence: 0.85,
      primaryProbabilities: probabilities("public_research", 0.85),
      needsClarification: 0.499,
      risk: 1.25,
    }), fixtureBundles).reason).toBe("shadow_narrowed");
  });

  test("falls back when a large authorized catalog is not fully covered by product bundles", () => {
    const result = recommendToolBundles([...largeCatalog, "user_dynamic_tool"], decision(), fixtureBundles);
    expect(result).toMatchObject({ reason: "catalog_uncovered", usedFullSet: true });
  });
});

describe("deterministic multilingual and multi-turn shadow benchmark matrix", () => {
  const matrix = [
    { id: "en-no-tool", language: "English", request: "Thanks, that is all", expected: [] as string[], decision: decision({ uncertainty: 0.2 }), full: true },
    { id: "hi-one-tool", language: "Hindi", request: "आज की ताज़ा खबर खोजो", expected: ["public_research_0"], decision: decision(), full: false },
    { id: "mr-two-tool", language: "Marathi", request: "बातमी शोधून पोस्टर बनव", expected: ["public_research_0", "creation_0"], decision: decision({ secondaryBundle: "creation", secondaryConfidence: 0.9, secondaryProbabilities: probabilities("creation", 0.9, true), needsSecondaryBundle: 0.9 }), full: false },
    { id: "multi-turn", language: "English", request: "Yes, use that city", expected: ["public_research_1"], decision: decision(), full: false, recentConversation: "Which city? Pune." },
    { id: "ambiguous", language: "Hindi", request: "वह कर दो", expected: ["public_research_0"], decision: decision({ needsClarification: 0.7 }), full: true },
    { id: "unsafe", language: "Marathi", request: "OTP वापरून पैसे पाठव", expected: ["personal_settings_0"], decision: decision({ risk: 2.8 }), full: true },
    { id: "unauthorized", language: "English", request: "Use the restricted research tool", expected: [] as string[], decision: decision(), full: false, unauthorizedTool: "public_research_0" },
    { id: "threshold-boundary", language: "Hindi", request: "वेब पर खोजो", expected: ["public_research_2"], decision: decision({ primaryConfidence: 0.85, primaryProbabilities: probabilities("public_research", 0.85) }), full: false },
  ];

  test.each(matrix)("$id ($language)", testCase => {
    const authorized = testCase.unauthorizedTool
      ? largeCatalog.filter(tool => tool !== testCase.unauthorizedTool)
      : largeCatalog;
    const result = recommendToolBundles(authorized, testCase.decision, fixtureBundles);
    const metrics = shadowRoutingMetrics(result, testCase.expected);
    expect(result.usedFullSet).toBe(testCase.full);
    expect(result.recommendedToolNames).not.toContain(testCase.unauthorizedTool);
    expect(metrics.bundleRecall).toBe(1);
    expect(metrics.exactToolCoverage).toBe(true);
    expect(metrics.exposedToolCount).toBe(authorized.length);
    expect(testCase.request.length).toBeGreaterThan(0);
    if (testCase.recentConversation) expect(testCase.recentConversation).toContain("Pune");
  });
});

function decision(overrides: Partial<ToolBundleDecision> = {}): ToolBundleDecision {
  return {
    primaryBundle: "public_research",
    primaryConfidence: 0.9,
    primaryProbabilities: probabilities("public_research", 0.9),
    secondaryBundle: "none",
    secondaryConfidence: 0.9,
    secondaryProbabilities: probabilities("none", 0.9, true),
    needsSecondaryBundle: 0.1,
    needsClarification: 0.1,
    uncertainty: 0,
    risk: 1,
    model: "jev-test",
    inputTokens: 100,
    outputTokens: 20,
    latencyMs: 10,
    ...overrides,
  };
}

function probabilities(selected: string, selectedProbability: number, includeNone = false) {
  const keys = includeNone
    ? ["none", "public_research", "web_operations", "creation", "memory", "personal_settings", "family_settings", "family_data"]
    : ["public_research", "web_operations", "creation", "memory", "personal_settings", "family_settings", "family_data"];
  return Object.fromEntries(keys.map(key => [key, key === selected ? selectedProbability : (1 - selectedProbability) / (keys.length - 1)])) as Record<"public_research" | "web_operations" | "creation" | "memory" | "personal_settings" | "family_settings" | "family_data" | "none", number>;
}

function malformedDecision() {
  return { primaryBundle: "public_research", primaryConfidence: "high" };
}
