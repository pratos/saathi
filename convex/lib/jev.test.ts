import { describe, expect, test } from "vitest";
import { MULTILINGUAL_INTENT_GUIDANCE, turnDecisionGuidance, type JevTurnDecision } from "./jev.js";
import { shouldIgnoreEmail } from "../gmail.js";

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
