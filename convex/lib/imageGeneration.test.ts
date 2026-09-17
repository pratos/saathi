import { describe, expect, test } from "vitest";
import { imageGenerationFailure } from "./imageGeneration.js";

describe("image generation provider failures", () => {
  test("turns OpenRouter age attestation failures into actionable safe guidance", () => {
    const body = JSON.stringify({
      error: {
        message: "This model requires 18+ age confirmation.",
        metadata: {
          missing_attestation_types: ["age_18plus"],
          user_id: "user_provider_identifier_that_must_not_leak",
        },
      },
    });

    const failure = imageGenerationFailure(403, body);

    expect(failure).toEqual({
      reason: "missing_age_attestation",
      message: expect.stringContaining("https://openrouter.ai/settings/preferences"),
    });
    expect(failure.message).not.toContain("user_provider_identifier");
    expect(failure.message).not.toContain("missing_attestation_types");
  });

  test.each([
    [401, "invalid_api_key", "invalid or expired"],
    [402, "insufficient_credits", "needs credits"],
    [429, "rate_limited", "busy right now"],
  ] as const)("maps status %s without exposing the provider response", (status, reason, message) => {
    const failure = imageGenerationFailure(status, "provider secret diagnostic");
    expect(failure).toMatchObject({ reason, message: expect.stringContaining(message) });
    expect(failure.message).not.toContain("provider secret diagnostic");
  });

  test("keeps unknown provider failures generic", () => {
    expect(imageGenerationFailure(503, "<html>private upstream details</html>")).toEqual({
      reason: "provider_503",
      message: "Saathi could not create that image because the image provider rejected the request. Please try again later.",
    });
  });
});
