import { afterEach, describe, expect, test, vi } from "vitest";
import { probabilityRecord, probabilityRecordSchema, runOpenRouterDecision } from "./decisionProvider.js";

const credential = {
  kind: "byok_openrouter" as const,
  apiKey: "sk-or-family-secret",
  model: "openai/gpt-family-tier",
};

afterEach(() => vi.unstubAllGlobals());

describe("provider-aware structured decisions", () => {
  test("uses the family OpenRouter model and returns structured output with usage", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      model: "openai/gpt-family-tier",
      choices: [{ message: { content: '{"route":"answer","confidence":0.91}' } }],
      usage: { prompt_tokens: 42, completion_tokens: 7 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runOpenRouterDecision<{ route: string; confidence: number }>(credential, {
      name: "test_route",
      state: { request: "hello" },
      instructions: "Choose a route.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["route", "confidence"],
        properties: { route: { type: "string" }, confidence: { type: "number" } },
      },
    })).resolves.toEqual({
      output: { route: "answer", confidence: 0.91 },
      model: "openai/gpt-family-tier",
      inputTokens: 42,
      outputTokens: 7,
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: "Bearer sk-or-family-secret" });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "openai/gpt-family-tier",
      response_format: { type: "json_schema", json_schema: { name: "test_route", strict: true } },
    });
  });

  test("fails without exposing provider response bodies and derives bounded choice probabilities", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream secret details", { status: 401 })));
    await expect(runOpenRouterDecision(credential, {
      name: "failure",
      state: {},
      instructions: "Classify.",
      schema: { type: "object" },
    })).rejects.toThrow("status 401");
    await expect(runOpenRouterDecision(credential, {
      name: "failure",
      state: {},
      instructions: "Classify.",
      schema: { type: "object" },
    })).rejects.not.toThrow("upstream secret details");

    expect(probabilityRecord(["a", "b", "c"] as const, { a: -1, b: 1.4, c: 0.2 })).toEqual({ a: 0, b: 1, c: 0.2 });
    expect(probabilityRecordSchema(["a", "b"])).toMatchObject({
      additionalProperties: false,
      required: ["a", "b"],
      properties: { a: { minimum: 0, maximum: 1 }, b: { minimum: 0, maximum: 1 } },
    });
  });
});
