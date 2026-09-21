import { describe, expect, test } from "vitest";
import { gptLiveCostUsd, liveVoiceUsageSeconds } from "./liveVoiceUsage";
import { estimateGptLunaCostUsd, estimateOpenAiWebSearchCostUsd } from "./usageCosts";

describe("GPT-Live usage", () => {
  test("prices provider-reported duration at the published per-minute rate", () => {
    expect(gptLiveCostUsd(90)).toBeCloseTo(0.075);
    expect(gptLiveCostUsd(-1)).toBe(0);
  });

  test("prices delegated Luna tokens separately from live session time", () => {
    expect(estimateGptLunaCostUsd({
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })).toBeCloseTo(1.42);
    expect(estimateGptLunaCostUsd({
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 1_000_000,
    })).toBeCloseTo(0.25);
    expect(estimateGptLunaCostUsd({ inputTokens: Number.NaN, outputTokens: Number.POSITIVE_INFINITY })).toBe(0);
    expect(estimateOpenAiWebSearchCostUsd(3)).toBeCloseTo(0.03);
    expect(estimateOpenAiWebSearchCostUsd(Number.NaN)).toBe(0);
  });

  test("accepts cumulative usage snapshots and final usage only", () => {
    expect(liveVoiceUsageSeconds({ type: "session.usage.updated", usage: { seconds: 12.5 } })).toBe(12.5);
    expect(liveVoiceUsageSeconds({ type: "session.closed", usage: { seconds: 31 } })).toBe(31);
    expect(liveVoiceUsageSeconds({ type: "response.event", usage: { seconds: 99 } })).toBeNull();
    expect(liveVoiceUsageSeconds({ type: "session.closed", usage: { seconds: -1 } })).toBeNull();
  });
});
