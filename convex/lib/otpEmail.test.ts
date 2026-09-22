import { describe, expect, test } from "vitest";
import { buildOtpEmail } from "./otpEmail";

describe("Saathi OTP email", () => {
  test("renders the exact code and a human-readable UTC expiry in both bodies", () => {
    const email = buildOtpEmail("259847", new Date("2026-09-22T13:31:24.166Z"));

    expect(email.subject).toBe("Your Saathi sign-in code");
    expect(email.text).toContain("Your one-time sign-in code is: 259847");
    expect(email.text).toContain("22 September 2026 at 1:31 pm UTC");
    expect(email.html).toContain(">259847</td>");
    expect(email.html).toContain("22 September 2026 at 1:31 pm UTC");
    expect(email.text).not.toContain("2026-09-22T13:31:24.166Z");
    expect(email.html).not.toContain("2026-09-22T13:31:24.166Z");
  });

  test("escapes code content in HTML without changing the plain-text fallback", () => {
    const email = buildOtpEmail("12<&\"'", new Date("2026-09-22T13:31:24.166Z"));

    expect(email.text).toContain("12<&\"'");
    expect(email.html).toContain("12&lt;&amp;&quot;&#39;");
    expect(email.html).not.toContain(">12<&\"'</td>");
  });

  test("does not include recipient or delivery credentials", () => {
    const serialized = JSON.stringify(buildOtpEmail("259847", new Date("2026-09-22T13:31:24.166Z")));

    expect(serialized).not.toContain("AGENTMAIL");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("@example");
  });
});
