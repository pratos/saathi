import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { env } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";

export async function resolveOpenAiKey(ctx: ActionCtx, spaceId: Id<"spaces">) {
  const owned = await ctx.runQuery(internal.spaces.resolveProviderKey, { spaceId, provider: "openai" })
    ?? await ctx.runQuery(internal.spaces.resolveProviderKey, { spaceId, provider: "codex" });
  return owned?.trim() || env.OPENAI_API_KEY?.trim() || "";
}

export async function resolveOpenRouterKey(ctx: ActionCtx, spaceId: Id<"spaces">) {
  const owned = await ctx.runQuery(internal.spaces.resolveProviderKey, { spaceId, provider: "openrouter" });
  return owned?.trim() || env.OPENROUTER_API_KEY;
}
