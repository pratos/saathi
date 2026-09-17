import { describe, expect, test } from "vitest";
import { MULTILINGUAL_INTENT_GUIDANCE, shouldBlockTool, turnDecisionGuidance, type JevToolDecision, type JevTurnDecision } from "./jev.js";
import { shouldIgnoreEmail } from "../gmail.js";
import { toolNamesForTurnDecision } from "../agentWorker.js";

const metadata = { model: "jev-latest", inputTokens: 20, latencyMs: 12 };

describe("Jev decision policy", () => {
  test("asks for clarification only when routing evidence crosses the policy boundary", () => {
    const answer = turn({ route: "answer", needsClarification: 0.71 });
    const clarify = turn({ route: "answer", needsClarification: 0.72 });
    const computer = turn({ route: "computer", needsClarification: 0.1 });
    expect(turnDecisionGuidance(answer)).toContain("likely route is answer");
    expect(turnDecisionGuidance(answer)).toContain("same language and script");
    expect(turnDecisionGuidance(clarify)).toContain("ask one focused clarification");
    expect(turnDecisionGuidance(clarify)).toContain("do not return [NO_REPLY]");
    expect(turnDecisionGuidance(computer)).toContain("concrete request that needs a reply");
    expect(MULTILINGUAL_INTENT_GUIDANCE).toMatch(/Marathi.*code-switching.*Hinglish/i);
  });

  test("blocks only a confident selected tool outcome and otherwise fails open", () => {
    expect(shouldBlockTool(tool({ outcome: "clarify", confidence: 0.8, probabilities: {
      execute: 0.1, clarify: 0.75, block: 0.15,
    } }))).toMatch(/missing detail/i);
    expect(shouldBlockTool(tool({ outcome: "block", confidence: 0.59, probabilities: {
      execute: 0.02, clarify: 0.03, block: 0.95,
    } }))).toBeNull();
    expect(shouldBlockTool(null)).toBeNull();
  });

  test("selects stable tool bundles only for confident Jev routes", () => {
    const expected = {
      answer: [],
      clarify: [],
      search: ["search_public_web"],
      computer: ["use_computer"],
      image: ["generate_image"],
      settings: ["set_reading_language", "set_image_style", "set_food_budget", "set_model_tier"],
      memory: ["remember", "recall", "forget_memory", "list_memories"],
      family_data: ["get_food_budget", "find_room_files", "search_family_inbox"],
    } satisfies Record<Exclude<JevTurnDecision["route"], "multi_tool">, readonly string[]>;
    for (const [route, tools] of Object.entries(expected)) {
      expect(toolNamesForTurnDecision(turn({
        route: route as JevTurnDecision["route"],
        routeConfidence: 0.9,
        routeProbabilities: probabilities(route as JevTurnDecision["route"], 0.9),
      }))).toEqual(tools);
    }
  });

  test("uses no tools for clarification, unions likely multi-tool bundles, and fails open when uncertain", () => {
    expect(toolNamesForTurnDecision(turn({
      route: "computer",
      routeConfidence: 0.99,
      routeProbabilities: probabilities("computer", 0.99),
      needsClarification: 0.72,
    }))).toEqual([]);
    expect(toolNamesForTurnDecision(turn({
      route: "search",
      routeConfidence: 0.84,
      routeProbabilities: probabilities("search", 0.9),
    }))).toBeNull();
    expect(toolNamesForTurnDecision(turn({
      route: "search",
      routeConfidence: 0.9,
      routeProbabilities: probabilities("search", 0.84),
    }))).toBeNull();
    expect(toolNamesForTurnDecision(turn({
      route: "multi_tool",
      routeConfidence: 0.95,
      routeProbabilities: {
        ...probabilities("multi_tool", 0.89),
        search: 0.06,
        memory: 0.05,
      },
    }))).toEqual(["search_public_web", "remember", "recall", "forget_memory", "list_memories"]);
    expect(toolNamesForTurnDecision(turn({
      route: "multi_tool",
      routeConfidence: 0.84,
      routeProbabilities: probabilities("multi_tool", 0.9),
    }))).toBeNull();
    expect(toolNamesForTurnDecision(null)).toBeNull();
  });

  test("skips extraction only for confident non-financial or login-code email", () => {
    const base = {
      category: "ignore" as const,
      confidence: 0.65,
      probabilities: { bills: 0.05, receipts: 0.05, bank: 0.05, ignore: 0.85 },
      tracksHouseholdMoney: 0.45,
      containsOtpOrLoginCode: 0.1,
      ...metadata,
    };
    expect(shouldIgnoreEmail(base)).toBe(true);
    expect(shouldIgnoreEmail({ ...base, tracksHouseholdMoney: 0.46 })).toBe(false);
    expect(shouldIgnoreEmail({ ...base, confidence: 0.64, containsOtpOrLoginCode: 0.95 })).toBe(false);
  });
});

function turn(overrides: Partial<JevTurnDecision>): JevTurnDecision {
  return {
    route: "answer",
    routeConfidence: 0.8,
    routeProbabilities: { answer: 0.8, clarify: 0.04, search: 0.04, computer: 0.02, image: 0.02, settings: 0.02, memory: 0.02, family_data: 0.02, multi_tool: 0.02 },
    needsClarification: 0.1,
    ...metadata,
    ...overrides,
  };
}

function tool(overrides: Partial<JevToolDecision>): JevToolDecision {
  return {
    outcome: "execute",
    confidence: 0.8,
    probabilities: { execute: 0.8, clarify: 0.1, block: 0.1 },
    ...metadata,
    ...overrides,
  };
}

function probabilities(route: JevTurnDecision["route"], selected: number): JevTurnDecision["routeProbabilities"] {
  const remainder = (1 - selected) / 8;
  return {
    answer: remainder,
    clarify: remainder,
    search: remainder,
    computer: remainder,
    image: remainder,
    settings: remainder,
    memory: remainder,
    family_data: remainder,
    multi_tool: remainder,
    [route]: selected,
  };
}
