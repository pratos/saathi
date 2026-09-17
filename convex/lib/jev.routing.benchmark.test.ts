import { describe, expect, test } from "vitest";
import { toolNamesForTurnDecision } from "../agentWorker.js";
import { assistantProviderTools } from "./assistantCapabilities.js";
import { decideAgentTurn, type JevTurnDecision } from "./jev.js";

const JEV_INPUT_PRICE_PER_MILLION = 0.042;

type Language = "en" | "hi" | "mr";
type Route = JevTurnDecision["route"];
type RoutingCase = { id: string; language: Language; kind: "single_turn" | "multi_turn" | "multi_tool"; text: string; context?: string; expectedRoute: Route };

const CASES: RoutingCase[] = [
  routing("en-answer", "en", "Explain why the sky looks blue in simple words.", "answer"),
  routing("en-search", "en", "What are today's top news stories in Pune?", "search"),
  routing("en-computer", "en", "Open the school portal and download Aarav's latest report card.", "computer"),
  routing("en-image", "en", "Create a warm illustrated birthday invitation for Aai.", "image"),
  routing("en-settings", "en", "Change my reading language to Marathi.", "settings"),
  routing("en-memory", "en", "Remember that our departure city is Pune.", "memory"),
  routing("en-family-data", "en", "Find the electricity bill saved in our family inbox.", "family_data"),
  routing("en-multi-tool", "en", "Find today's Pune weather and remember that we prefer morning walks.", "multi_tool", "multi_tool"),
  routing("en-clarify", "en", "Change it for me.", "clarify"),
  multiTurn("en-followup-image", "en", "Use a warm watercolor style.", "Person: Make an invitation for Aai's birthday.\nSaathi: What visual style should I use?", "image"),
  multiTurn("en-followup-memory", "en", "Pune.", "Person: Remember our departure city.\nSaathi: Which city should I remember?", "memory"),
  multiTurn("en-followup-family-data", "en", "The electricity one from last month.", "Person: Find our saved bill.\nSaathi: Which bill should I look for?", "family_data"),
  multiTurn("en-context-switch", "en", "Actually, just explain how invitations are usually worded.", "Person: Create a birthday invitation.\nSaathi: What style should I use?", "answer"),

  routing("hi-answer", "hi", "आसमान नीला क्यों दिखता है? आसान भाषा में समझाओ।", "answer"),
  routing("hi-search", "hi", "आज पुणे की मुख्य खबरें क्या हैं?", "search"),
  routing("hi-computer", "hi", "School portal खोलकर आरव का latest report card download कर दो।", "computer"),
  routing("hi-image", "hi", "आई के जन्मदिन के लिए एक सुंदर illustrated invitation बनाओ।", "image"),
  routing("hi-settings", "hi", "मेरी reading language मराठी कर दो।", "settings"),
  routing("hi-memory", "hi", "याद रखो कि हम पुणे से सफ़र शुरू करेंगे।", "memory"),
  routing("hi-family-data", "hi", "हमारे saved inbox में बिजली का bill ढूँढो।", "family_data"),
  routing("hi-multi-tool", "hi", "आज पुणे का मौसम ढूँढो और याद रखो कि हमें सुबह walk पसंद है।", "multi_tool", "multi_tool"),
  routing("hi-clarify", "hi", "इसे मेरे लिए बदल दो।", "clarify"),
  multiTurn("hi-followup-image", "hi", "Warm watercolor style रखो।", "Person: आई के birthday का invitation बनाओ।\nSaathi: कौन-सा visual style रखूँ?", "image"),
  multiTurn("hi-followup-memory", "hi", "पुणे।", "Person: हमारा departure city याद रखो।\nSaathi: कौन-सा शहर याद रखूँ?", "memory"),
  multiTurn("hi-followup-family-data", "hi", "पिछले महीने वाला बिजली bill।", "Person: हमारा saved bill ढूँढो।\nSaathi: कौन-सा bill देखूँ?", "family_data"),
  multiTurn("hi-context-switch", "hi", "नहीं, बस बताओ invitation में आम तौर पर क्या लिखा जाता है।", "Person: Birthday invitation बनाओ।\nSaathi: कौन-सा style रखूँ?", "answer"),

  routing("mr-answer", "mr", "आकाश निळं का दिसतं, हे सोप्या भाषेत सांग.", "answer"),
  routing("mr-search", "mr", "आजच्या पुण्यातल्या मुख्य बातम्या शोधून सांग.", "search"),
  routing("mr-computer", "mr", "शाळेचं पोर्टल उघडून आरवचं नवीन रिपोर्ट कार्ड डाउनलोड कर.", "computer"),
  routing("mr-image", "mr", "आईच्या वाढदिवसासाठी एक छान चित्रमय निमंत्रण तयार कर.", "image"),
  routing("mr-settings", "mr", "माझी वाचण्याची भाषा मराठी कर.", "settings"),
  routing("mr-memory", "mr", "आपण पुण्याहून प्रवास सुरू करणार आहोत, हे लक्षात ठेव.", "memory"),
  routing("mr-family-data", "mr", "आपल्या जतन केलेल्या इनबॉक्समध्ये विजेचं बिल शोध.", "family_data"),
  routing("mr-multi-tool", "mr", "आज पुण्याचं हवामान शोध आणि आम्हाला सकाळी फिरायला आवडतं हे लक्षात ठेव.", "multi_tool", "multi_tool"),
  routing("mr-clarify", "mr", "ते माझ्यासाठी बदलून दे.", "clarify"),
  multiTurn("mr-followup-image", "mr", "उबदार वॉटरकलर शैली ठेव.", "Person: आईच्या वाढदिवसाचं निमंत्रण बनव.\nSaathi: कोणती दृश्यशैली ठेवू?", "image"),
  multiTurn("mr-followup-memory", "mr", "पुणे.", "Person: आपण कुठून निघणार ते लक्षात ठेव.\nSaathi: कोणतं शहर लक्षात ठेवू?", "memory"),
  multiTurn("mr-followup-family-data", "mr", "गेल्या महिन्याचं विजेचं बिल.", "Person: आपलं जतन केलेलं बिल शोध.\nSaathi: कोणतं बिल पाहू?", "family_data"),
  multiTurn("mr-context-switch", "mr", "नको, फक्त निमंत्रणात साधारण काय लिहितात ते सांग.", "Person: वाढदिवसाचं निमंत्रण बनव.\nSaathi: कोणती शैली ठेवू?", "answer"),
];

describe("Jev multilingual routing benchmark corpus", () => {
  test("covers every route equally in English, Hindi, and Marathi", () => {
    for (const language of ["en", "hi", "mr"] satisfies Language[]) {
      const cases = CASES.filter(item => item.language === language);
      expect(cases).toHaveLength(13);
      expect(new Set(cases.map(item => item.expectedRoute))).toEqual(new Set<Route>([
        "answer", "clarify", "search", "computer", "image", "settings", "memory", "family_data", "multi_tool",
      ]));
      expect(cases.filter(item => item.kind === "multi_turn")).toHaveLength(4);
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
    kind: RoutingCase["kind"];
    estimatedSchemaTokens: number;
    exposedToolCount: number;
    inputTokens: number;
    latencyMs: number;
  }> = [];

  test.each(CASES)("$language · $id", async benchmark => {
    expect(apiKey, "Set TYPESAFE_API_KEY before running the live routing benchmark.").not.toBe("");
    const decision = await decideAgentTurn(apiKey, benchmark.text, benchmark.context);
    const selectedTools = toolNamesForTurnDecision(decision);
    const expectedTools = toolsForRoute(benchmark.expectedRoute);
    const selectionCorrect = selectedTools === null || selectedTools.length === 0 || arraysEqual(selectedTools, expectedTools);
    results.push({
      language: benchmark.language,
      routeCorrect: decision.route === benchmark.expectedRoute,
      selectedTools,
      selectionCorrect,
      needsClarification: decision.needsClarification,
      kind: benchmark.kind,
      estimatedSchemaTokens: schemaStats(selectedTools).tokens,
      exposedToolCount: schemaStats(selectedTools).tools,
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
    if (benchmark.expectedRoute === "multi_tool"
      && decision.routeConfidence >= 0.85
      && decision.routeProbabilities.multi_tool >= 0.85) {
      expect(selectedTools, `A confident multi-tool route should expose only its likely domain bundles: ${evidence}`)
        .toEqual(expectedTools);
    }
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
      multiTurnAccuracy: results.filter(item => item.kind === "multi_turn" && item.routeCorrect).length
        / results.filter(item => item.kind === "multi_turn").length,
      multiToolAccuracy: results.filter(item => item.kind === "multi_tool" && item.routeCorrect).length
        / results.filter(item => item.kind === "multi_tool").length,
      averageExposedTools: results.reduce((total, item) => total + item.exposedToolCount, 0) / results.length,
      averageToolSchemaTokens: Math.round(results.reduce((total, item) => total + item.estimatedSchemaTokens, 0) / results.length),
      perLanguage,
      inputTokens,
      averageLatencyMs: Math.round(results.reduce((total, item) => total + item.latencyMs, 0) / results.length),
      estimatedCostUsd: inputTokens / 1_000_000 * JEV_INPUT_PRICE_PER_MILLION,
    }));
  });
});

function routing(id: string, language: Language, text: string, expectedRoute: Route, kind: RoutingCase["kind"] = "single_turn"): RoutingCase {
  return { id, language, kind, text, expectedRoute };
}

function multiTurn(id: string, language: Language, text: string, context: string, expectedRoute: Route): RoutingCase {
  return { id, language, kind: "multi_turn", text, context, expectedRoute };
}

function toolsForRoute(route: Route): readonly string[] {
  if (route === "search") return ["search_public_web"];
  if (route === "computer") return ["use_computer"];
  if (route === "image") return ["generate_image"];
  if (route === "settings") return ["set_reading_language", "set_image_style", "set_food_budget", "set_model_tier"];
  if (route === "memory") return ["remember", "recall", "forget_memory", "list_memories"];
  if (route === "family_data") return ["get_food_budget", "find_room_files", "search_family_inbox"];
  if (route === "multi_tool") return ["search_public_web", "remember", "recall", "forget_memory", "list_memories"];
  return [];
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function schemaStats(selectedTools: readonly string[] | null) {
  const applicationTools = assistantProviderTools();
  const tools: unknown[] = selectedTools === null
    ? [...applicationTools]
    : applicationTools.filter(tool => selectedTools.includes(tool.name));
  if (selectedTools === null || selectedTools.includes("search_public_web")) {
    tools.push({
      type: "openrouter:web_search",
      parameters: { engine: "auto", max_results: 4, max_uses: 2, max_total_results: 6 },
    });
  }
  return { tools: tools.length, tokens: Math.ceil(JSON.stringify(tools).length / 4) };
}
