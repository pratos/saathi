export const GPT_LIVE_PRICE_USD_PER_MINUTE = 0.05;

export function gptLiveCostUsd(seconds: number) {
  return Math.max(0, seconds) / 60 * GPT_LIVE_PRICE_USD_PER_MINUTE;
}

export function liveVoiceUsageSeconds(event: Record<string, unknown>) {
  if (event.type !== "session.usage.updated" && event.type !== "session.closed") return null;
  const usage = event.usage && typeof event.usage === "object"
    ? event.usage as Record<string, unknown>
    : null;
  const seconds = usage?.seconds;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
    ? seconds
    : null;
}
