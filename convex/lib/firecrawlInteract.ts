const FIRECRAWL_API = "https://api.firecrawl.dev/v2";
const CHECKOUT_TASK = /\b(check\s*out|place\s+an?\s+order|complete\s+(the\s+)?purchase|buy\s+now|make\s+(a\s+)?payment|pay\s+now)\b/i;
const SECRET_IN_TASK = /\b(password|passwd|passcode|otp|pin|cvv)\s*[:=]\s*\S+/i;

export type FirecrawlLiveView = {
  scrapeId: string;
  liveViewUrl?: string;
  interactiveLiveViewUrl?: string;
  output: string;
};

export type FirecrawlCodeResult = Omit<FirecrawlLiveView, "output"> & {
  stdout: string;
  result: string;
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
  if (isBlockedComputerHost(parsed.hostname.toLowerCase())) {
    throw new Error("Computer use cannot open local or private addresses.");
  }
  return parsed.toString();
}

function isBlockedComputerHost(host: string) {
  if (
    host === "localhost"
    || host === "localhost.localdomain"
    || host === "metadata.google.internal"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host.endsWith(".arpa")
  ) return true;
  const ipv4 = parseIPv4(host);
  if (ipv4) return isBlockedIPv4(ipv4);
  if (host.includes(":")) return isBlockedIPv6(host);
  return false;
}

function parseIPv4(host: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split(".").map(part => Number(part));
  if (parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts as [number, number, number, number];
}

function isBlockedIPv4([a, b]: [number, number, number, number]) {
  return a === 0
    || a === 10
    || a === 127
    || a >= 224
    || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 168
    || a === 100 && b >= 64 && b <= 127;
}

function isBlockedIPv6(host: string) {
  const compact = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (compact === "::" || compact === "::1" || compact === "0:0:0:0:0:0:0:1") return true;
  if (compact.startsWith("fe80:") || compact.startsWith("fc") || compact.startsWith("fd")) return true;
  const mapped = compact.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const ipv4 = parseIPv4(mapped[1]);
    return ipv4 ? isBlockedIPv4(ipv4) : true;
  }
  return compact.startsWith("::ffff:");
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

/** Starts a scrape-bound browser without invoking Firecrawl's prompt agent. */
export async function startFirecrawlCodeSession(options: {
  apiKey: string;
  url: string;
  profileName: string;
}) {
  const url = assertSafeComputerUrl(options.url);
  const profileName = options.profileName.trim();
  if (!profileName) throw new Error("A browser profile is required.");
  return {
    scrapeId: await scrapeForInteract(options.apiKey, url, profileName.slice(0, 100)),
  };
}

/** Runs application-created code only. Never pass model output into `code`. */
export async function runFirecrawlCode(options: {
  apiKey: string;
  scrapeId: string;
  code: string;
  timeoutSeconds?: number;
}): Promise<FirecrawlCodeResult> {
  const scrapeId = assertScrapeId(options.scrapeId);
  const code = options.code.trim();
  if (!code || code.length > 100_000) throw new Error("Invalid browser command.");
  const timeout = Math.min(Math.max(options.timeoutSeconds ?? 30, 1), 60);
  const payload = await firecrawlFetch(options.apiKey, `/scrape/${encodeURIComponent(scrapeId)}/interact`, {
    method: "POST",
    timeoutMs: (timeout + 15) * 1_000,
    body: { code, language: "bash", timeout, origin: "saathi-jev-browser" },
  });
  return parseCodeResult(payload, scrapeId);
}

export async function observeFirecrawlCodeSession(options: { apiKey: string; scrapeId: string }) {
  return runFirecrawlCode({
    ...options,
    code: "printf '__SAATHI_URL__\\n'; agent-browser get url; printf '\\n__SAATHI_SNAPSHOT__\\n'; agent-browser snapshot -i",
    timeoutSeconds: 20,
  });
}

export async function stopFirecrawlCodeSession(apiKey: string, scrapeId: string) {
  return stopInteract(apiKey, assertScrapeId(scrapeId));
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

export function parseCodeResult(payload: unknown, scrapeId: string): FirecrawlCodeResult {
  if (!payload || typeof payload !== "object") throw new Error("The remote browser returned an invalid response.");
  const root = payload as Record<string, unknown>;
  if (root.success === false || root.killed === true || (typeof root.exitCode === "number" && root.exitCode !== 0)) {
    throw new Error("The remote browser command failed.");
  }
  return {
    scrapeId,
    stdout: rawText(root.stdout, 100_000),
    result: rawText(root.result, 20_000),
    liveViewUrl: asHttpUrl(root.liveViewUrl),
    interactiveLiveViewUrl: asHttpUrl(root.interactiveLiveViewUrl),
  };
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

function assertScrapeId(value: string) {
  const scrapeId = value.trim();
  if (!/^[A-Za-z0-9_-]{3,200}$/.test(scrapeId)) throw new Error("Invalid browser session.");
  return scrapeId;
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

function rawText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}
