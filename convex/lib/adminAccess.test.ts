import { describe, expect, test } from "vitest";
import { adminAccessDigest, constantTimeHexEqual } from "./adminAccess";

describe("admin review credential helpers", () => {
  test("binds the digest to a normalized email and the exact access code", async () => {
    const expected = await adminAccessDigest("admin@example.com", "correct horse battery staple");
    await expect(adminAccessDigest(" ADMIN@EXAMPLE.COM ", "correct horse battery staple")).resolves.toBe(expected);
    await expect(adminAccessDigest("other@example.com", "correct horse battery staple")).resolves.not.toBe(expected);
    await expect(adminAccessDigest("admin@example.com", "Correct horse battery staple")).resolves.not.toBe(expected);
  });

  test("compares hexadecimal digests without accepting prefixes or case drift", () => {
    expect(constantTimeHexEqual("aabb", "AABB")).toBe(true);
    expect(constantTimeHexEqual("aabb", "aab")).toBe(false);
    expect(constantTimeHexEqual("aabb", "aabc")).toBe(false);
  });
});
