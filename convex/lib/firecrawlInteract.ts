const FIRECRAWL_API = "https://api.firecrawl.dev/v2";
const CHECKOUT_TASK = /\b(check\s*out|place\s+an?\s+order|complete\s+(the\s+)?purchase|buy\s+now|make\s+(a\s+)?payment|pay\s+now)\b/i;
const SECRET_IN_TASK = /\b(password|passwd|passcode|otp|pin|cvv)\s*[:=]\s*\S+/i;

export type FirecrawlLiveView = {
  scrapeId: string;
  liveViewUrl?: string;
  interactiveLiveViewUrl?: string;
  output: string;
};

export function profileNameForUser(userId: string) {
  const compact = userId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  if (!compact) throw new Error("A browser profile could not be created for this account.");
  return `saathi-user-${compact}`;
}

export function assertSafeComputerUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("Open a specific https website.");
  }
  if (parsed.protocol !== "https:") throw new Error("Computer use only opens https websites.");
  if (parsed.username || parsed.password) throw new Error("Do not put credentials in the website address.");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "127.0.0.1") {
    throw new Error("Computer use cannot open local addresses.");
  }
  return parsed.toString();
}

export function assertSafeComputerTask(task: string) {
  const trimmed = task.trim();
  if (trimmed.length < 3 || trimmed.length > 4_000) throw new Error("Describe what to do on the page in a short request.");
  if (CHECKOUT_TASK.test(trimmed)) throw new Error("Saathi will not check out, pay, or place an order.");
  if (SECRET_IN_TASK.test(trimmed)) throw new Error("Do not send passwords or one-time codes in chat. Sign in in the live browser instead.");
  return trimmed;
}

export function parseScrapeId(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
  const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata as Record<string, unknown> : {};
  for (const value of [metadata.scrapeId, metadata.scrape_id, root.scrapeId, data.scrapeId]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function parseInteractResult(payload: unknown, scrapeId: string): FirecrawlLiveView {
  if (!payload || typeof payload !== "object") {
    return { scrapeId, output: "" };
  }
  const root = payload as Record<string, unknown>;
  const liveViewUrl = asHttpUrl(root.liveViewUrl);
  const interactiveLiveViewUrl = asHttpUrl(root.interactiveLiveViewUrl);
  const output = firstText(root.output, root.result, root.stdout);
  return { scrapeId, liveViewUrl, interactiveLiveViewUrl, output };
}

export async function runFirecrawlComputerTask(options: {
  apiKey: string;
  url: string;
  task: string;
  profileName: string;
  existingScrapeId?: string;
  onLiveView?: (view: FirecrawlLiveView) => Promise<void>;
}) {
  const url = assertSafeComputerUrl(options.url);
  const task = assertSafeComputerTask(options.task);
  const scrapeId = options.existingScrapeId?.trim() || await scrapeForInteract(options.apiKey, url, options.profileName);
  try {
    const preview = await interact(options.apiKey, scrapeId, {
      prompt: "Reply with the current page title and whether a login form is visible. Do not click, type, or submit anything.",
      timeout: 45,
    });
    await options.onLiveView?.(preview);
    const result = await interact(options.apiKey, scrapeId, {
      prompt: computerTaskPrompt(task),
      timeout: 240,
    });
    await options.onLiveView?.(result);
    return { scrapeId, output: result.output || preview.output || "The live browser finished without extra notes.", liveViewUrl: result.interactiveLiveViewUrl ?? result.liveViewUrl ?? preview.interactiveLiveViewUrl ?? preview.liveViewUrl };
  } finally {
    await stopInteract(options.apiKey, scrapeId);
  }
}

export function computerTaskPrompt(task: string) {
  return `Complete this single browsing task on the current page: ${task}

Rules:
- Never type passwords, OTPs, PINs, or payment details.
- If login is required, wait for the human to sign in through the interactive live view, then continue.
- Never checkout, pay, place an order, or submit a purchase.
- Stay on the same site unless the task requires one clearly related public page.
- Return a concise result of what you saw or did.`;
}

async function scrapeForInteract(apiKey: string, url: string, profileName: string) {
  const payload = await firecrawlFetch(apiKey, "/scrape", {
    method: "POST",
    timeoutMs: 90_000,
    body: {
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      profile: { name: profileName, saveChanges: true },
    },
  });
  const scrapeId = parseScrapeId(payload);
  if (!scrapeId) throw new Error("Firecrawl did not start a browser session for that page.");
  return scrapeId;
}

async function interact(apiKey: string, scrapeId: string, body: { prompt: string; timeout: number }) {
  const payload = await firecrawlFetch(apiKey, `/scrape/${encodeURIComponent(scrapeId)}/interact`, {
    method: "POST",
    timeoutMs: (body.timeout + 15) * 1_000,
    body: { prompt: body.prompt, timeout: body.timeout, origin: "saathi" },
  });
  return parseInteractResult(payload, scrapeId);
}

async function stopInteract(apiKey: string, scrapeId: string) {
  try {
    await firecrawlFetch(apiKey, `/scrape/${encodeURIComponent(scrapeId)}/interact`, {
      method: "DELETE",
      timeoutMs: 20_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function firecrawlFetch(apiKey: string, path: string, options: { method: string; timeoutMs: number; body?: unknown }) {
  const response = await fetch(`${FIRECRAWL_API}${path}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Firecrawl Interact failed (${response.status}): ${text.replace(/\s+/g, " ").slice(0, 400)}`);
  }
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Firecrawl Interact returned an invalid response.");
  }
}

function asHttpUrl(value: unknown) {
  return typeof value === "string" && /^https:\/\//i.test(value) ? value : undefined;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.replace(/\s+/g, " ").trim().slice(0, 8_000);
  }
  return "";
}
