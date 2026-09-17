import { Type } from "typebox";
import { GENERATE_IMAGE_TOOL, IMAGE_STYLES, type ImageStyle } from "./imageSafety";

export type ConversationAction =
  | { type: "set_language"; language: "en" | "hi" | "mr" }
  | { type: "set_image_style"; style: ImageStyle }
  | { type: "set_food_budget"; amount: number; currency: "INR" | "USD" }
  | { type: "set_model_tier"; tier: "low" | "med" | "high" | "ultra" }
  | { type: "remember"; key: string; value: string }
  | { type: "recall"; key: string };

export const SEARCH_PUBLIC_WEB_TOOL = {
  type: "function",
  name: "search_public_web",
  label: "Search public web",
  description: "Search current public web and news sources with Firecrawl. Use for recent news, changing facts, or claims that need current evidence. Never include private family data in the query.",
  parameters: Type.Object({ query: Type.String({ minLength: 2, maxLength: 300 }) }, { additionalProperties: false }),
} as const;

export const USE_COMPUTER_TOOL = {
  type: "function",
  name: "use_computer",
  label: "Use computer",
  description: "Open a public https website and complete a browsing task. Use only when a person explicitly asks to browse, click through, log in, or operate a site. Never type passwords, OTPs, or payment details. Never checkout, pay, or place an order.",
  parameters: Type.Object({
    url: Type.String({ minLength: 8, maxLength: 2_000 }),
    task: Type.String({ minLength: 3, maxLength: 4_000 }),
  }, { additionalProperties: false }),
} as const;

const SET_READING_LANGUAGE_TOOL = {
  type: "function",
  name: "set_reading_language",
  label: "Set reading language",
  description: "Change the caller's own reading language after they explicitly ask. This affects only that person.",
  parameters: Type.Object({ language: Type.Union([Type.Literal("en"), Type.Literal("hi"), Type.Literal("mr")]) }, { additionalProperties: false }),
} as const;

const SET_IMAGE_STYLE_TOOL = {
  type: "function",
  name: "set_image_style",
  label: "Set image style",
  description: "Change the caller's default image style after they explicitly ask.",
  parameters: Type.Object({ style: Type.Union(IMAGE_STYLES.map(style => Type.Literal(style))) }, { additionalProperties: false }),
} as const;

const SET_FOOD_BUDGET_TOOL = {
  type: "function",
  name: "set_food_budget",
  label: "Set food budget",
  description: "Set the family's monthly food budget after an owner explicitly gives an amount and currency.",
  parameters: Type.Object({
    amount: Type.Number(),
    currency: Type.Union([Type.Literal("INR"), Type.Literal("USD")]),
  }, { additionalProperties: false }),
} as const;

const SET_MODEL_TIER_TOOL = {
  type: "function",
  name: "set_model_tier",
  label: "Set thinking level",
  description: "Change how deeply Saathi thinks for this family after an owner explicitly asks. Medium is the normal default; high and ultra use more resources.",
  parameters: Type.Object({ tier: Type.Union([Type.Literal("low"), Type.Literal("med"), Type.Literal("high"), Type.Literal("ultra")]) }, { additionalProperties: false }),
} as const;

const REMEMBER_TOOL = {
  type: "function",
  name: "remember",
  label: "Remember",
  description: "Store a stable family fact only when the caller explicitly asks Saathi to remember it. Use a short descriptive key and do not retain secrets.",
  parameters: Type.Object({
    key: Type.String({ minLength: 1, maxLength: 100 }),
    value: Type.String({ minLength: 1, maxLength: 10_000 }),
  }, { additionalProperties: false }),
} as const;

const RECALL_TOOL = {
  type: "function",
  name: "recall",
  label: "Recall",
  description: "Look up a stable family fact by its short descriptive key when it is relevant to the caller's request.",
  parameters: Type.Object({ key: Type.String({ minLength: 1, maxLength: 100 }) }, { additionalProperties: false }),
} as const;

export const CONVERSATION_ACTION_TOOLS = [
  SET_READING_LANGUAGE_TOOL,
  SET_IMAGE_STYLE_TOOL,
  SET_FOOD_BUDGET_TOOL,
  SET_MODEL_TIER_TOOL,
  REMEMBER_TOOL,
  RECALL_TOOL,
] as const;

export const APPLICATION_ASSISTANT_TOOLS = [
  SEARCH_PUBLIC_WEB_TOOL,
  GENERATE_IMAGE_TOOL,
  USE_COMPUTER_TOOL,
  ...CONVERSATION_ACTION_TOOLS,
] as const;

export type ApplicationAssistantToolName = (typeof APPLICATION_ASSISTANT_TOOLS)[number]["name"];
export type ConversationActionToolName = (typeof CONVERSATION_ACTION_TOOLS)[number]["name"];

export function assistantProviderTools() {
  return APPLICATION_ASSISTANT_TOOLS.map(({ label: _label, ...tool }) => tool);
}

export function conversationActionFromTool(name: string, value: unknown): ConversationAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const args = value as Record<string, unknown>;
  if (name === "set_reading_language" && (args.language === "en" || args.language === "hi" || args.language === "mr")) {
    return { type: "set_language", language: args.language };
  }
  if (name === "set_image_style" && typeof args.style === "string" && (IMAGE_STYLES as readonly string[]).includes(args.style)) {
    return { type: "set_image_style", style: args.style as ImageStyle };
  }
  if (name === "set_food_budget" && typeof args.amount === "number" && (args.currency === "INR" || args.currency === "USD")) {
    return { type: "set_food_budget", amount: args.amount, currency: args.currency };
  }
  if (name === "set_model_tier" && (args.tier === "low" || args.tier === "med" || args.tier === "high" || args.tier === "ultra")) {
    return { type: "set_model_tier", tier: args.tier };
  }
  if (name === "remember" && typeof args.key === "string" && typeof args.value === "string") {
    return { type: "remember", key: args.key, value: args.value };
  }
  if (name === "recall" && typeof args.key === "string") return { type: "recall", key: args.key };
  return null;
}
