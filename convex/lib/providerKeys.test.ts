import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel.js";
import { resolveDecisionCredential, resolveOptionalDecisionCredential } from "./providerKeys.js";

const spaceId = "space" as Id<"spaces">;
const userId = "user" as Id<"users">;

afterEach(() => vi.unstubAllEnvs());

describe("decision credential routing", () => {
  test("prefers family OpenRouter BYOK and keeps its current model tier", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "deployment-typesafe-key");
    const ctx = context({
      ownedOpenRouterSecret: " sk-or-family-key ",
      openRouterModel: "x-ai/grok-family-tier",
      platformAllowed: true,
      blocked: false,
    });
    await expect(resolveOptionalDecisionCredential(ctx, spaceId, userId)).resolves.toEqual({
      kind: "byok_openrouter",
      apiKey: "sk-or-family-key",
      model: "x-ai/grok-family-tier",
    });
  });

  test("uses only the deployment TypeSafe key for approved managed access", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", " deployment-typesafe-key ");
    const ctx = context({
      ownedOpenRouterSecret: null,
      openRouterModel: "unused/model",
      platformAllowed: true,
      blocked: false,
    });
    await expect(resolveOptionalDecisionCredential(ctx, spaceId, userId)).resolves.toEqual({
      kind: "managed_typesafe",
      apiKey: "deployment-typesafe-key",
    });
  });

  test("skips optional decisions for unapproved accounts and rejects them when required", async () => {
    const unapproved = {
      ownedOpenRouterSecret: null,
      openRouterModel: "unused/model",
      platformAllowed: false,
      blocked: false,
    };
    await expect(resolveOptionalDecisionCredential(context(unapproved), spaceId, userId)).resolves.toBeNull();
    await expect(resolveDecisionCredential(context(unapproved), spaceId, userId)).rejects.toThrow("Add an OpenRouter key or request access");

    await expect(resolveOptionalDecisionCredential(context({
      ownedOpenRouterSecret: "sk-or-family-key",
      openRouterModel: "family/model",
      platformAllowed: true,
      blocked: true,
    }), spaceId, userId)).rejects.toThrow("AI access is blocked");
  });
});

function context(result: {
  ownedOpenRouterSecret: string | null;
  openRouterModel: string;
  platformAllowed: boolean;
  blocked: boolean;
}) {
  return { runQuery: vi.fn(async () => result) } as never;
}
