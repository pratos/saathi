export const MODEL_TIERS = {
  low: {
    id: "low",
    label: "Low",
    detail: "DeepSeek V4.1 Flash",
    model: "deepseek/deepseek-v4.1-flash",
    thinkingLevel: "low",
  },
  med: {
    id: "med",
    label: "Medium",
    detail: "Luna, mid thinking",
    model: "openai/gpt-5.6-luna",
    thinkingLevel: "medium",
  },
  high: {
    id: "high",
    label: "High",
    detail: "Grok 4.6, mid thinking",
    model: "x-ai/grok-4.6",
    thinkingLevel: "medium",
  },
  ultra: {
    id: "ultra",
    label: "Ultra",
    detail: "Sol, high thinking",
    model: "openai/gpt-5.6-sol",
    thinkingLevel: "high",
  },
} as const;

export type ModelTier = keyof typeof MODEL_TIERS;
export type SaathiThinkingLevel = (typeof MODEL_TIERS)[ModelTier]["thinkingLevel"];
export const DEFAULT_MODEL_TIER: ModelTier = "med";

export function isModelTier(value: string | undefined): value is ModelTier {
  return value === "low" || value === "med" || value === "high" || value === "ultra";
}

export function resolveModelTier(tier: string | undefined) {
  return isModelTier(tier) ? MODEL_TIERS[tier] : MODEL_TIERS[DEFAULT_MODEL_TIER];
}
