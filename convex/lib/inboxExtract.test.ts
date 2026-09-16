import { describe, expect, test } from "vitest";
import { extractPasswordHints, findDocumentUrls, inferDirection, parseMarkdownFromFirecrawl } from "./inboxExtract";

describe("inbox document helpers", () => {
  test("finds https PDF links and ignores credentialed URLs", () => {
    expect(findDocumentUrls('<a href="https://cdn.example.com/bill.pdf?token=1">pdf</a>', "")).toEqual([
      "https://cdn.example.com/bill.pdf?token=1",
    ]);
    expect(findDocumentUrls("", "See https://user:pass@evil.example/secret.pdf")).toEqual([]);
  });

  test("extracts password hints without storing card numbers", () => {
    expect(extractPasswordHints("Magzter invoice", "PDF password: POLICY-8821")).toBe("POLICY-8821");
    expect(extractPasswordHints("Bank statement", "password: 4111111111111111")).toBeUndefined();
  });

  test("treats family-sent mail as outgoing", () => {
    expect(inferDirection("me@home.test", "family@agentmail.to", "Thank you for your payment")).toBe("outgoing");
    expect(inferDirection("bills@magzter.test", "family@agentmail.to", "Your Magzter subscription renews")).toBe("incoming");
  });

  test("reads Firecrawl markdown from current parse/scrape envelopes", () => {
    expect(parseMarkdownFromFirecrawl({ success: true, data: { markdown: "# Invoice\nTotal 499" } })).toContain("Invoice");
    expect(parseMarkdownFromFirecrawl({ markdown: "Page 1" })).toBe("Page 1");
  });
});
