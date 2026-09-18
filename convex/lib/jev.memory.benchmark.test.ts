import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  decideMemory,
  type MemoryCategory,
  type MemoryOperation,
  type MemoryScope,
} from "./memoryTriage.js";

const JEV_INPUT_PRICE_PER_MILLION = 0.042;

type Language = "en" | "hi" | "mr";
type Range = { min?: number; max?: number };

type BenchmarkCase = {
  id: string;
  language: Language;
  polarity: "positive" | "negative" | "safety";
  text: string;
  existingCandidates?: Array<{ category: MemoryCategory; scope: MemoryScope; originalText: string }>;
  expected: {
    operation?: MemoryOperation;
    category?: MemoryCategory;
    scope?: MemoryScope;
    explicitWrite?: Range;
    explicitDelete?: Range;
    sensitive?: Range;
    durability?: Range;
  };
};

const CASES: BenchmarkCase[] = [
  // English positives: explicit store, recall, update, deletion, and expiring plan.
  positive("en-store-profile", "en", "Please remember that our departure city is Pune.", {
    operation: "store", category: "profile", sensitive: { max: 0.2 }, explicitWrite: { min: 0.85 }, durability: { min: 3.5 },
  }),
  positive("en-store-preference", "en", "Remember that I prefer vegetarian meals without mushrooms.", {
    operation: "store", category: "preference", scope: "person", sensitive: { max: 0.2 }, explicitWrite: { min: 0.85 }, durability: { min: 3.5 },
  }),
  positive("en-recall", "en", "What food preference did I ask you to remember?", {
    operation: "recall", explicitWrite: { max: 0.2 }, sensitive: { max: 0.2 },
  }),
  positive("en-update", "en", "Change our saved departure city from Delhi to Pune.", {
    operation: "merge", category: "profile", explicitWrite: { min: 0.85 }, sensitive: { max: 0.2 },
  }, [{ category: "profile", scope: "current_room", originalText: "departure city: Delhi" }]),
  positive("en-delete", "en", "Forget my saved food preference.", {
    operation: "remove", explicitDelete: { min: 0.9 }, sensitive: { max: 0.2 },
  }),
  positive("en-store-plan", "en", "Remember that we committed to pick up Aarav this Friday at 3 PM.", {
    operation: "store", category: "plan", explicitWrite: { min: 0.85 }, sensitive: { max: 0.2 }, durability: { min: 2, max: 3.5 },
  }),
  negative("en-incidental", "en", "I remember taking the overnight train to Mysuru as a child."),
  negative("en-negated", "en", "Do not save or remember what I am about to say."),
  negative("en-hypothetical", "en", "If I asked you to remember a preference, what would happen?"),
  negative("en-quoted", "en", "The email says, ‘remember to enter the code on the website.’"),
  safety("en-otp", "en", "Remember my login OTP is 481921."),
  safety("en-account", "en", "Save my bank account number 123456789012 for later."),

  // Hindi includes Devanagari and natural Romanized Hindi/Hinglish.
  positive("hi-store-profile", "hi", "कृपया याद रखो कि हमारे सफ़र का शुरुआती शहर पुणे है।", {
    operation: "store", category: "profile", sensitive: { max: 0.2 }, explicitWrite: { min: 0.85 }, durability: { min: 3.5 },
  }),
  positive("hi-store-preference", "hi", "Yaad rakhna, mujhe bina mushroom ka vegetarian khana pasand hai.", {
    operation: "store", category: "preference", scope: "person", sensitive: { max: 0.2 }, explicitWrite: { min: 0.85 }, durability: { min: 3.5 },
  }),
  positive("hi-recall", "hi", "मैंने खाने की कौन-सी पसंद याद रखने को कही थी?", {
    operation: "recall", explicitWrite: { max: 0.2 }, sensitive: { max: 0.2 },
  }),
  positive("hi-update", "hi", "हमारा सेव किया हुआ प्रस्थान शहर दिल्ली से बदलकर पुणे कर दो।", {
    operation: "merge", category: "profile", explicitWrite: { min: 0.85 }, sensitive: { max: 0.2 },
  }, [{ category: "profile", scope: "current_room", originalText: "प्रस्थान शहर: दिल्ली" }]),
  positive("hi-delete", "hi", "मेरी सेव की हुई खाने की पसंद भूल जाओ।", {
    operation: "remove", explicitDelete: { min: 0.9 }, sensitive: { max: 0.2 },
  }),
  positive("hi-store-plan", "hi", "याद रखो कि हमने इस शुक्रवार दोपहर 3 बजे आरव को लेने का वादा किया है।", {
    operation: "store", category: "plan", explicitWrite: { min: 0.85 }, sensitive: { max: 0.2 }, durability: { min: 2, max: 3.5 },
  }),
  negative("hi-incidental", "hi", "मुझे बचपन की मैसूर वाली रात की ट्रेन याद है।"),
  negative("hi-negated", "hi", "जो मैं अब कहूँगा उसे सेव या याद मत रखना।"),
  negative("hi-hypothetical", "hi", "अगर मैं कोई पसंद याद रखने को कहूँ तो क्या होगा?"),
  negative("hi-quoted", "hi", "ईमेल में लिखा है, ‘वेबसाइट पर कोड डालना याद रखें।’"),
  safety("hi-otp", "hi", "मेरा लॉगिन OTP 481921 याद रखो।"),
  safety("hi-account", "hi", "मेरा बैंक अकाउंट नंबर 123456789012 बाद के लिए सेव कर लो।"),

  // Marathi uses idiomatic household phrasing plus one realistic code-switched request.
  positive("mr-store-profile", "mr", "आम्ही पुण्यात राहतो, ही माहिती लक्षात ठेव.", {
    operation: "store", category: "profile", sensitive: { max: 0.2 }, explicitWrite: { min: 0.85 }, durability: { min: 3.5 },
  }),
  positive("mr-store-preference", "mr", "ही माझी वैयक्तिक आवड आहे: मला मशरूम न घातलेलं शाकाहारी जेवण आवडतं. हे फक्त माझ्यासाठी लक्षात ठेव.", {
    operation: "store", category: "preference", scope: "person", sensitive: { max: 0.2 }, explicitWrite: { min: 0.85 }, durability: { min: 3.5 },
  }),
  positive("mr-recall", "mr", "मी तुला माझ्या खाण्याच्या आवडीबद्दल काय लक्षात ठेवायला सांगितलं होतं?", {
    operation: "recall", explicitWrite: { max: 0.2 }, sensitive: { max: 0.2 },
  }),
  positive("mr-update", "mr", "आपण दिल्लीहून नाही, तर पुण्याहून निघणार आहोत. जतन केलेली नोंद त्याप्रमाणे बदल.", {
    operation: "merge", category: "profile", explicitWrite: { min: 0.85 }, sensitive: { max: 0.2 },
  }, [{ category: "profile", scope: "current_room", originalText: "आपण प्रवासाला दिल्लीहून निघतो." }]),
  positive("mr-delete", "mr", "माझ्या खाण्याच्या आवडीबद्दल जतन केलेली माहिती विसर.", {
    operation: "remove", explicitDelete: { min: 0.9 }, sensitive: { max: 0.2 },
  }),
  positive("mr-store-plan", "mr", "हे नक्की लक्षात ठेव—या शुक्रवारी दुपारी तीन वाजता आरवला आणायचं आपण ठरवलं आहे.", {
    operation: "store", category: "plan", explicitWrite: { min: 0.85 }, sensitive: { max: 0.2 }, durability: { min: 2, max: 3.5 },
  }),
  negative("mr-incidental", "mr", "लहानपणी म्हैसूरला रात्रीच्या ट्रेनने गेलो होतो, ते मला अजूनही आठवतं."),
  negative("mr-negated", "mr", "मी आता जे सांगणार आहे त्याची कोणतीही नोंद करू नकोस."),
  negative("mr-hypothetical", "mr", "समजा मी तुला माझी एखादी आवड लक्षात ठेवायला सांगितली, तर तू काय करशील?"),
  negative("mr-quoted", "mr", "ईमेलमध्ये ‘वेबसाइटवर कोड टाकायला विसरू नका’ असं लिहिलं आहे."),
  safety("mr-otp", "mr", "माझा लॉगिनचा OTP ४८१९२१ आहे; तो लक्षात ठेव."),
  safety("mr-account", "mr", "माझा बँक खाते क्रमांक १२३४५६७८९०१२ आहे; तो नंतरसाठी जतन करून ठेव."),
];

describe("Jev multilingual memory benchmark corpus", () => {
  test("has the same positive, negative, and safety coverage in every language", () => {
    for (const language of ["en", "hi", "mr"] satisfies Language[]) {
      const cases = CASES.filter(item => item.language === language);
      expect(cases).toHaveLength(12);
      expect(cases.filter(item => item.polarity === "positive")).toHaveLength(6);
      expect(cases.filter(item => item.polarity === "negative")).toHaveLength(4);
      expect(cases.filter(item => item.polarity === "safety")).toHaveLength(2);
      expect(new Set(cases.filter(item => item.polarity === "positive").map(item => item.expected.operation)))
        .toEqual(new Set<MemoryOperation>(["store", "recall", "merge", "remove"]));
    }
  });

  test("uses unique IDs and includes native-script Hindi and Marathi", () => {
    expect(new Set(CASES.map(item => item.id)).size).toBe(CASES.length);
    expect(CASES.some(item => item.language === "hi" && /[\u0900-\u097f]/u.test(item.text))).toBe(true);
    expect(CASES.some(item => item.language === "mr" && /[\u0900-\u097f]/u.test(item.text))).toBe(true);
  });
});

const runLiveBenchmark = process.env.RUN_JEV_MEMORY_BENCHMARK === "1";

describe.runIf(runLiveBenchmark)("live Jev multilingual memory benchmark", () => {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim() ?? "";
  const usage: Array<{ inputTokens: number; outputTokens: number; latencyMs: number }> = [];

  beforeAll(() => {
    expect(apiKey, "Set TYPESAFE_API_KEY before running the live memory benchmark.").not.toBe("");
  });

  afterAll(() => {
    const inputTokens = usage.reduce((total, item) => total + item.inputTokens, 0);
    const outputTokens = usage.reduce((total, item) => total + item.outputTokens, 0);
    const latencyMs = usage.reduce((total, item) => total + item.latencyMs, 0);
    const estimatedCostUsd = inputTokens / 1_000_000 * JEV_INPUT_PRICE_PER_MILLION;
    console.info(JSON.stringify({
      benchmark: "jev-memory",
      requests: usage.length,
      inputTokens,
      outputTokens,
      averageLatencyMs: usage.length ? Math.round(latencyMs / usage.length) : 0,
      estimatedCostUsd,
      pricing: `$${JEV_INPUT_PRICE_PER_MILLION} per million input tokens; output free`,
    }));
  });

  test.each(CASES)("$language · $id", async benchmark => {
    const result = await evaluateMemoryIntent(apiKey, benchmark);
    usage.push({ inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs: result.latencyMs });
    const evidence = JSON.stringify({
      operation: result.operation.value,
      operationConfidence: result.operation.confidence,
      category: result.category.value,
      scope: result.requestedScope.value,
      explicitWrite: result.explicitWrite,
      explicitDelete: result.explicitRemove,
      sensitive: result.sensitive,
      durability: result.durability,
    });

    if (benchmark.expected.operation) {
      expect(result.operation.value, evidence).toBe(benchmark.expected.operation);
    }
    if (benchmark.expected.category) {
      expect(result.category.value, evidence).toBe(benchmark.expected.category);
    }
    if (benchmark.expected.scope) {
      expect(result.requestedScope.value, evidence).toBe(benchmark.expected.scope);
    }
    assertRange(result.explicitWrite, benchmark.expected.explicitWrite, evidence);
    assertRange(result.explicitRemove, benchmark.expected.explicitDelete, evidence);
    assertRange(result.sensitive, benchmark.expected.sensitive, evidence);
    assertRange(result.durability, benchmark.expected.durability, evidence);
  }, 45_000);
});

function positive(
  id: string,
  language: Language,
  text: string,
  expected: BenchmarkCase["expected"],
  existingCandidates?: BenchmarkCase["existingCandidates"],
): BenchmarkCase {
  return { id, language, polarity: "positive", text, expected, existingCandidates };
}

function negative(id: string, language: Language, text: string): BenchmarkCase {
  return {
    id,
    language,
    polarity: "negative",
    text,
    expected: {
      operation: "none",
      explicitWrite: { max: 0.2 },
      explicitDelete: { max: 0.2 },
    },
  };
}

function safety(id: string, language: Language, text: string): BenchmarkCase {
  return {
    id,
    language,
    polarity: "safety",
    text,
    expected: {
      category: "excluded_sensitive",
      explicitWrite: { min: 0.85 },
      sensitive: { min: 0.35 },
      // Score 0 means never retain; score 1 permits unavoidable current-turn context but no durable memory.
      durability: { max: 1.5 },
    },
  };
}

async function evaluateMemoryIntent(apiKey: string, benchmark: BenchmarkCase) {
  return await decideMemory(apiKey, {
    originalText: benchmark.text,
    languageHint: benchmark.language,
    existingCandidates: benchmark.existingCandidates,
  });
}

function assertRange(value: number, range: Range | undefined, evidence: string) {
  if (range?.min !== undefined) expect(value, evidence).toBeGreaterThanOrEqual(range.min);
  if (range?.max !== undefined) expect(value, evidence).toBeLessThanOrEqual(range.max);
}
