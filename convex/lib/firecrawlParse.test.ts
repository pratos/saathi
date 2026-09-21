import { afterEach, describe, expect, test, vi } from "vitest";
import { classifyFirecrawlParseFailure, parsePublicDocument } from "./firecrawlParse";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("Firecrawl PDF failure classification", () => {
  test("stops retries for setup, credit, and unsupported-document failures", () => {
    expect(classifyFirecrawlParseFailure(401, "Unauthorized")).toMatchObject({
      passwordProtected: false,
      retryable: false,
      error: expect.stringContaining("authorization"),
    });
    expect(classifyFirecrawlParseFailure(402, "Payment required")).toMatchObject({
      passwordProtected: false,
      retryable: false,
      error: expect.stringContaining("credits"),
    });
    expect(classifyFirecrawlParseFailure(422, "Unsupported document")).toMatchObject({
      passwordProtected: false,
      retryable: false,
    });
  });

  test("allows a manual retry for rate limits and provider outages", () => {
    expect(classifyFirecrawlParseFailure(429, "Too many requests")).toMatchObject({
      passwordProtected: false,
      retryable: true,
      error: expect.stringContaining("rate-limited"),
    });
    expect(classifyFirecrawlParseFailure(503, "Unavailable")).toMatchObject({
      passwordProtected: false,
      retryable: true,
    });
  });

  test("returns a retryable result instead of throwing on a network failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    await expect(parsePublicDocument("test-key", "https://example.test/file.pdf")).resolves.toMatchObject({
      markdown: "",
      passwordProtected: false,
      retryable: true,
      error: expect.stringContaining("timed out"),
    });
  });

  test("keeps password-protected files terminal without blaming provider authorization", () => {
    expect(classifyFirecrawlParseFailure(403, "The PDF is password-protected")).toEqual({
      passwordProtected: true,
      retryable: false,
      error: "This PDF is password-protected.",
    });
  });
});
