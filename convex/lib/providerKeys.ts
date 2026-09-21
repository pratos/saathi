import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { env } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import type { ByokProvider } from "./byok";
import type { DecisionCredential } from "./decisionProvider";

export type ProviderBillingSource = "platform" | "family";

export type ResolvedProviderCredential = {
  apiKey: string;
  billingSource: ProviderBillingSource;
};

async function resolveCredential(
  ctx: ActionCtx,
  spaceId: Id<"spaces">,
  userId: Id<"users">,
  providers: readonly ByokProvider[],
  deploymentSecret: string | undefined,
  label: string,
): Promise<ResolvedProviderCredential> {
  let platformAllowed = false;
  for (const provider of providers) {
    const access = await ctx.runQuery(internal.spaces.resolveProviderCredential, { spaceId, userId, provider });
    if (access.blocked) {
      throw new ConvexError({ code: "ACCESS_BLOCKED", message: "AI access is blocked for this account" });
    }
    if (access.ownedSecret?.trim()) {
      return { apiKey: access.ownedSecret.trim(), billingSource: "family" };
    }
    platformAllowed ||= access.platformAllowed;
  }
  if (!platformAllowed) {
    throw new ConvexError({ code: "AI_ACCESS_REQUIRED", message: `Add a ${label} key or request access` });
  }
  const configured = deploymentSecret?.trim();
  if (!configured) {
    throw new ConvexError({ code: "PROVIDER_NOT_CONFIGURED", message: `${label} is not configured on this deployment` });
  }
  return { apiKey: configured, billingSource: "platform" };
}

export function resolveOpenAiCredential(ctx: ActionCtx, spaceId: Id<"spaces">, userId: Id<"users">) {
  return resolveCredential(ctx, spaceId, userId, ["openai", "codex"], env.OPENAI_API_KEY, "OpenAI");
}

export async function resolveOpenAiKey(ctx: ActionCtx, spaceId: Id<"spaces">, userId: Id<"users">) {
  return (await resolveOpenAiCredential(ctx, spaceId, userId)).apiKey;
}

export function resolveOpenRouterCredential(ctx: ActionCtx, spaceId: Id<"spaces">, userId: Id<"users">) {
  return resolveCredential(ctx, spaceId, userId, ["openrouter"], env.OPENROUTER_API_KEY, "OpenRouter");
}

export async function resolveOpenRouterKey(ctx: ActionCtx, spaceId: Id<"spaces">, userId: Id<"users">) {
  return (await resolveOpenRouterCredential(ctx, spaceId, userId)).apiKey;
}

export async function resolveDecisionCredential(
  ctx: ActionCtx,
  spaceId: Id<"spaces">,
  userId: Id<"users">,
): Promise<DecisionCredential> {
  const credential = await decisionCredential(ctx, spaceId, userId, true);
  if (!credential) throw new Error("Required decision credential was not resolved");
  return credential;
}

export function resolveOptionalDecisionCredential(
  ctx: ActionCtx,
  spaceId: Id<"spaces">,
  userId: Id<"users">,
): Promise<DecisionCredential | null> {
  return decisionCredential(ctx, spaceId, userId, false);
}

async function decisionCredential(
  ctx: ActionCtx,
  spaceId: Id<"spaces">,
  userId: Id<"users">,
  required: boolean,
): Promise<DecisionCredential | null> {
  const access = await ctx.runQuery(internal.spaces.resolveDecisionCredential, { spaceId, userId });
  if (access.blocked) {
    throw new ConvexError({ code: "ACCESS_BLOCKED", message: "AI access is blocked for this account" });
  }
  const openRouterKey = access.ownedOpenRouterSecret?.trim();
  if (openRouterKey) {
    return { kind: "byok_openrouter", apiKey: openRouterKey, model: access.openRouterModel };
  }
  if (!access.platformAllowed) {
    if (!required) return null;
    throw new ConvexError({ code: "AI_ACCESS_REQUIRED", message: "Add an OpenRouter key or request access" });
  }
  const apiKey = env.TYPESAFE_API_KEY?.trim();
  if (apiKey) return { kind: "managed_typesafe", apiKey };
  if (!required) return null;
  throw new ConvexError({
    code: "PROVIDER_NOT_CONFIGURED",
    message: "TypeSafe is not configured on this deployment",
  });
}
