import { describe, expect, test } from "vitest";
import { gptLiveCostUsd, liveVoiceUsageSeconds } from "./liveVoiceUsage";

describe("GPT-Live usage", () => {
  test("prices provider-reported duration at the published per-minute rate", () => {
    expect(gptLiveCostUsd(90)).toBeCloseTo(0.075);
    expect(gptLiveCostUsd(-1)).toBe(0);
  });

  test("accepts cumulative usage snapshots and final usage only", () => {
    expect(liveVoiceUsageSeconds({ type: "session.usage.updated", usage: { seconds: 12.5 } })).toBe(12.5);
    expect(liveVoiceUsageSeconds({ type: "session.closed", usage: { seconds: 31 } })).toBe(31);
    expect(liveVoiceUsageSeconds({ type: "response.event", usage: { seconds: 99 } })).toBeNull();
    expect(liveVoiceUsageSeconds({ type: "session.closed", usage: { seconds: -1 } })).toBeNull();
  });
});
