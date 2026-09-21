export const GPT_LUNA_MODEL = "gpt-5.6-luna";

// OpenAI list prices as of the GPT-5.6 launch. Keep delegated text-model
// accounting separate from GPT-Live session time.
const GPT_LUNA_USD_PER_MILLION = {
  input: 0.2,
  cachedInput: 0.02,
  output: 1.2,
  cacheWrite: 0.25,
};
const OPENAI_WEB_SEARCH_USD_PER_CALL = 0.01;

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  webSearchCalls?: number;
};

export function estimateGptLunaCostUsd(usage: TokenUsage) {
  return (
    finiteNonnegative(usage.inputTokens) * GPT_LUNA_USD_PER_MILLION.input
    + finiteNonnegative(usage.cachedInputTokens) * GPT_LUNA_USD_PER_MILLION.cachedInput
    + finiteNonnegative(usage.outputTokens) * GPT_LUNA_USD_PER_MILLION.output
    + finiteNonnegative(usage.cacheWriteTokens) * GPT_LUNA_USD_PER_MILLION.cacheWrite
  ) / 1_000_000;
}

export function estimateOpenAiWebSearchCostUsd(calls: number) {
  return finiteNonnegative(calls) * OPENAI_WEB_SEARCH_USD_PER_CALL;
}

function finiteNonnegative(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;
}
