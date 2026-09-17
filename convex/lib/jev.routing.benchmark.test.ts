import { describe, expect, test } from "vitest";
import { toolNamesForTurnDecision } from "../agentWorker.js";
import { decideAgentTurn, type JevTurnDecision } from "./jev.js";

const JEV_INPUT_PRICE_PER_MILLION = 0.042;

type Language = "en" | "hi" | "mr";
type Route = JevTurnDecision["route"];
type RoutingCase = { id: string; language: Language; text: string; expectedRoute: Route };

const CASES: RoutingCase[] = [
  routing("en-answer", "en", "Explain why the sky looks blue in simple words.", "answer"),
  routing("en-search", "en", "What are today's top news stories in Pune?", "search"),
  routing("en-computer", "en", "Open the school portal and download Aarav's latest report card.", "computer"),
  routing("en-image", "en", "Create a warm illustrated birthday invitation for Aai.", "image"),
  routing("en-settings", "en", "Change my reading language to Marathi.", "settings"),
  routing("en-memory", "en", "Remember that our departure city is Pune.", "memory"),
  routing("en-clarify", "en", "Change it for me.", "clarify"),

  routing("hi-answer", "hi", "आसमान नीला क्यों दिखता है? आसान भाषा में समझाओ।", "answer"),
  routing("hi-search", "hi", "आज पुणे की मुख्य खबरें क्या हैं?", "search"),
  routing("hi-computer", "hi", "School portal खोलकर आरव का latest report card download कर दो।", "computer"),
  routing("hi-image", "hi", "आई के जन्मदिन के लिए एक सुंदर illustrated invitation बनाओ।", "image"),
  routing("hi-settings", "hi", "मेरी reading language मराठी कर दो।", "settings"),
  routing("hi-memory", "hi", "याद रखो कि हम पुणे से सफ़र शुरू करेंगे।", "memory"),
  routing("hi-clarify", "hi", "इसे मेरे लिए बदल दो।", "clarify"),

  routing("mr-answer", "mr", "आकाश निळं का दिसतं, हे सोप्या भाषेत सांग.", "answer"),
  routing("mr-search", "mr", "आजच्या पुण्यातल्या मुख्य बातम्या शोधून सांग.", "search"),
  routing("mr-computer", "mr", "शाळेचं पोर्टल उघडून आरवचं नवीन रिपोर्ट कार्ड डाउनलोड कर.", "computer"),
  routing("mr-image", "mr", "आईच्या वाढदिवसासाठी एक छान चित्रमय निमंत्रण तयार कर.", "image"),
  routing("mr-settings", "mr", "माझी वाचण्याची भाषा मराठी कर.", "settings"),
  routing("mr-memory", "mr", "आपण पुण्याहून प्रवास सुरू करणार आहोत, हे लक्षात ठेव.", "memory"),
  routing("mr-clarify", "mr", "ते माझ्यासाठी बदलून दे.", "clarify"),
];

describe("Jev multilingual routing benchmark corpus", () => {
  test("covers every route equally in English, Hindi, and Marathi", () => {
    for (const language of ["en", "hi", "mr"] satisfies Language[]) {
      const cases = CASES.filter(item => item.language === language);
      expect(cases).toHaveLength(7);
      expect(new Set(cases.map(item => item.expectedRoute))).toEqual(new Set<Route>([
        "answer", "clarify", "search", "computer", "image", "settings", "memory",
      ]));
    }
  });
});

const runLiveBenchmark = process.env.RUN_JEV_ROUTING_BENCHMARK === "1";

describe.runIf(runLiveBenchmark)("live Jev multilingual routing benchmark", () => {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim() ?? "";
  const results: Array<{
    language: Language;
    routeCorrect: boolean;
    selectedTools: readonly string[] | null;
    selectionCorrect: boolean;
    needsClarification: number;
    inputTokens: number;
    latencyMs: number;
  }> = [];

  test.each(CASES)("$language · $id", async benchmark => {
    expect(apiKey, "Set TYPESAFE_API_KEY before running the live routing benchmark.").not.toBe("");
    const decision = await decideAgentTurn(apiKey, benchmark.text);
    const selectedTools = toolNamesForTurnDecision(decision);
    const expectedTools = toolsForRoute(benchmark.expectedRoute);
    const selectionCorrect = selectedTools === null || selectedTools.length === 0 || arraysEqual(selectedTools, expectedTools);
    results.push({
      language: benchmark.language,
      routeCorrect: decision.route === benchmark.expectedRoute,
      selectedTools,
      selectionCorrect,
      needsClarification: decision.needsClarification,
      inputTokens: decision.inputTokens,
      latencyMs: decision.latencyMs,
    });
    const evidence = JSON.stringify({
      expectedRoute: benchmark.expectedRoute,
      actualRoute: decision.route,
      confidence: decision.routeConfidence,
      selectedProbability: decision.routeProbabilities[decision.route],
      needsClarification: decision.needsClarification,
      selectedTools,
    });
    expect(decision.route, evidence).toBe(benchmark.expectedRoute);
    expect(selectionCorrect, `Jev confidently restricted Pi to the wrong tools: ${evidence}`).toBe(true);
  }, 45_000);

  test("reports aggregate routing cost and safe narrowing coverage", () => {
    expect(results).toHaveLength(CASES.length);
    const inputTokens = results.reduce((total, item) => total + item.inputTokens, 0);
    const narrowed = results.filter(item => item.selectedTools !== null);
    const perLanguage = Object.fromEntries((["en", "hi", "mr"] satisfies Language[]).map(language => {
      const languageResults = results.filter(item => item.language === language);
      return [language, {
        routeAccuracy: languageResults.filter(item => item.routeCorrect).length / languageResults.length,
        narrowedTurns: languageResults.filter(item => item.selectedTools !== null).length,
      }];
    }));
    console.info(JSON.stringify({
      benchmark: "jev-routing",
      requests: results.length,
      routeAccuracy: results.filter(item => item.routeCorrect).length / results.length,
      safeNarrowingCoverage: narrowed.filter(item => item.selectionCorrect).length / results.length,
      fullToolFallbacks: results.filter(item => item.selectedTools === null).length,
      clarificationOnlyTurns: results.filter(item => item.selectedTools?.length === 0 && item.needsClarification >= 0.72).length,
      wrongRestrictedBundles: narrowed.filter(item => !item.selectionCorrect).length,
      perLanguage,
      inputTokens,
      averageLatencyMs: Math.round(results.reduce((total, item) => total + item.latencyMs, 0) / results.length),
      estimatedCostUsd: inputTokens / 1_000_000 * JEV_INPUT_PRICE_PER_MILLION,
    }));
  });
});

function routing(id: string, language: Language, text: string, expectedRoute: Route): RoutingCase {
  return { id, language, text, expectedRoute };
}

function toolsForRoute(route: Route): readonly string[] {
  if (route === "search") return ["search_public_web"];
  if (route === "computer") return ["use_computer"];
  if (route === "image") return ["generate_image"];
  if (route === "settings") return ["set_reading_language", "set_image_style", "set_food_budget", "set_model_tier"];
  if (route === "memory") return ["remember", "recall"];
  return [];
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
