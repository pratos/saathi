import { afterEach, describe, expect, test, vi } from "vitest";
import { decideAgentTurn, decideEmail } from "./jev.js";
import { decideMemory } from "./memoryTriage.js";
import { decideToolBundles } from "./toolBundleRouting.js";
import { decideBrowserStep, pageFingerprint, type BrowserAction } from "./voiceBrowserController.js";

const credential = {
  kind: "byok_openrouter" as const,
  apiKey: "sk-or-family-key",
  model: "family/current-tier",
};

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter-backed decision workloads", () => {
  test("routes turn, email, memory, tools, and browser decisions through one BYOK adapter", async () => {
    const outputs: Record<string, unknown> = {
      saath_turn_route: {
        route: "answer", routeConfidence: 0.92,
        routeProbabilities: distribution("answer", ["answer", "clarify", "search", "computer", "image", "settings", "memory", "family_data", "multi_tool"]),
        needsClarification: 0.03,
      },
      saath_email_route: {
        category: "bills", confidence: 0.9,
        probabilities: distribution("bills", ["bills", "receipts", "bank", "ignore"]),
        tracksHouseholdMoney: 0.94, containsOtpOrLoginCode: 0.01,
      },
      saath_memory_decision: {
        operation: "store", operationConfidence: 0.91,
        operationProbabilities: distribution("store", ["store", "merge", "remove", "recall", "relevance", "none"]),
        category: "profile", categoryConfidence: 0.88,
        categoryProbabilities: distribution("profile", ["preference", "profile", "plan", "household", "excluded_sensitive", "other"]),
        requestedScope: "person", requestedScopeConfidence: 0.9,
        requestedScopeProbabilities: distribution("person", ["person", "family", "conversation"]),
        explicitWrite: 0.96, explicitRemove: 0.01, sensitive: 0.02, relevance: 3, durability: 4,
      },
      saath_tool_bundle_route: {
        primaryBundle: "memory", primaryConfidence: 0.93,
        primaryProbabilities: distribution("memory", ["public_research", "web_operations", "creation", "memory", "personal_settings", "family_settings", "family_data"]),
        secondaryBundle: "none", secondaryConfidence: 0.9,
        secondaryProbabilities: distribution("none", ["none", "public_research", "web_operations", "creation", "memory", "personal_settings", "family_settings", "family_data"]),
        needsSecondaryBundle: 0.02, needsClarification: 0.03, uncertainty: 0, risk: 1,
      },
      saath_browser_step: {
        selectedActionId: "done", selectedConfidence: 0.95, selectedProbabilities: { done: 1 },
        goalComplete: 0.98, needsUser: 0.01, madeProgress: 0.9, risk: 0,
      },
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { model: string; response_format: { json_schema: { name: string } } };
      const output = outputs[request.response_format.json_schema.name];
      return new Response(JSON.stringify({
        model: request.model,
        choices: [{ message: { content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const fingerprint = pageFingerprint("Done");
    const actions: BrowserAction[] = [{ id: "done", kind: "done", label: "Done", risk: "read_only", pageFingerprint: fingerprint }];
    const [turn, email, memory, tools, browser] = await Promise.all([
      decideAgentTurn(credential, "hello"),
      decideEmail(credential, { sender: "power@example.com", subject: "Bill", text: "Pay ₹500" }),
      decideMemory(credential, { originalText: "Remember my home city is Pune" }),
      decideToolBundles(credential, "Remember Pune"),
      decideBrowserStep(credential, {
        goal: "Check completion", latestVoiceInstruction: "Is it done?",
        page: { url: "https://example.com", fingerprint }, accessibilityTree: "Done", actions,
      }),
    ]);

    expect(turn).toMatchObject({ route: "answer", model: "family/current-tier" });
    expect(email).toMatchObject({ category: "bills", model: "family/current-tier" });
    expect(memory).toMatchObject({ operation: { value: "store" }, model: "family/current-tier" });
    expect(tools).toMatchObject({ primaryBundle: "memory", model: "family/current-tier" });
    expect(browser).toMatchObject({ selectedActionId: "done", model: "family/current-tier" });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

function distribution(selected: string, choices: string[]) {
  const remainder = choices.length > 1 ? 0.05 / (choices.length - 1) : 0;
  return Object.fromEntries(choices.map(choice => [choice, choice === selected ? 0.95 : remainder]));
}
