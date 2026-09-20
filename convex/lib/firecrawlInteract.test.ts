import { describe, expect, test } from "vitest";
import {
  assertSafeComputerTask,
  assertSafeComputerUrl,
  computerTaskPrompt,
  parseCodeResult,
  parseInteractResult,
  parseScrapeId,
  profileNameForUser,
} from "./firecrawlInteract";

describe("Firecrawl Interact computer use", () => {
  test("builds a stable per-user Firecrawl profile without storing passwords", () => {
    expect(profileNameForUser("jh7abc123")).toBe("saathi-user-jh7abc123");
    expect(profileNameForUser("users:abc_def")).toBe("saathi-user-usersabc_def");
    expect(computerTaskPrompt("Open my orders")).toContain("Never type passwords");
    expect(computerTaskPrompt("Open my orders")).toContain("Never checkout");
  });

  test("rejects checkout, local URLs, and secrets pasted into the task", () => {
    expect(() => assertSafeComputerUrl("http://example.com")).toThrow(/https/i);
    expect(() => assertSafeComputerUrl("https://localhost/login")).toThrow(/local or private/i);
    expect(() => assertSafeComputerUrl("https://user:pass@example.com")).toThrow(/credentials/i);
    expect(() => assertSafeComputerUrl("https://127.0.0.1/login")).toThrow(/local or private/i);
    expect(() => assertSafeComputerUrl("https://192.168.1.1/admin")).toThrow(/local or private/i);
    expect(() => assertSafeComputerUrl("https://10.0.0.8/router")).toThrow(/local or private/i);
    expect(() => assertSafeComputerUrl("https://169.254.169.254/latest/meta-data/")).toThrow(/local or private/i);
    expect(() => assertSafeComputerUrl("https://[::1]/")).toThrow(/local or private/i);
    expect(() => assertSafeComputerUrl("https://metadata.google.internal/")).toThrow(/local or private/i);
    expect(assertSafeComputerUrl("https://swiggy.com/my-account")).toBe("https://swiggy.com/my-account");
    expect(() => assertSafeComputerTask("Please checkout and place an order")).toThrow(/order/i);
    expect(() => assertSafeComputerTask("password: hunter2")).toThrow(/password/i);
    expect(assertSafeComputerTask("Show the current cart total")).toContain("current cart");
  });

  test("reads scrape and live-view fields from current Firecrawl response shapes", () => {
    expect(parseScrapeId({ data: { metadata: { scrapeId: "scrape_123" } } })).toBe("scrape_123");
    expect(parseScrapeId({ data: { metadata: { scrape_id: "scrape_legacy" } } })).toBe("scrape_legacy");
    expect(parseInteractResult({
      success: true,
      liveViewUrl: "https://liveview.firecrawl.dev/watch",
      interactiveLiveViewUrl: "https://liveview.firecrawl.dev/control",
      output: "Logged-in dashboard is visible",
    }, "scrape_123")).toEqual({
      scrapeId: "scrape_123",
      liveViewUrl: "https://liveview.firecrawl.dev/watch",
      interactiveLiveViewUrl: "https://liveview.firecrawl.dev/control",
      output: "Logged-in dashboard is visible",
    });
    expect(parseInteractResult({ liveViewUrl: "javascript:alert(1)" }, "scrape_123").liveViewUrl).toBeUndefined();
    expect(parseCodeResult({
      success: true,
      stdout: "@e1 [button] Search",
      result: "ok",
      exitCode: 0,
      liveViewUrl: "https://liveview.firecrawl.dev/watch",
    }, "scrape_123")).toMatchObject({
      scrapeId: "scrape_123",
      stdout: "@e1 [button] Search",
      result: "ok",
      liveViewUrl: "https://liveview.firecrawl.dev/watch",
    });
    expect(() => parseCodeResult({ success: false, stderr: "provider details" }, "scrape_123"))
      .toThrow("remote browser command failed");
  });
});
