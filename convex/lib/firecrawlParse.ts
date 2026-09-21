import { isPasswordParseError, parseMarkdownFromFirecrawl } from "./inboxExtract";

const FIRECRAWL_API = "https://api.firecrawl.dev/v2";
const FIRECRAWL_PARSE_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = FIRECRAWL_PARSE_TIMEOUT_MS + 15_000;

export type DocumentParseResult = {
  markdown: string;
  passwordProtected: boolean;
  retryable: boolean;
  error: string;
};

export async function parsePublicDocument(apiKey: string, url: string): Promise<DocumentParseResult> {
  try {
    const response = await fetch(`${FIRECRAWL_API}/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        timeout: FIRECRAWL_PARSE_TIMEOUT_MS,
        parsers: [{ type: "pdf", mode: "auto", maxPages: 20 }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await parseFirecrawlResponse(response);
  } catch (error) {
    return networkParseFailure(error);
  }
}

export async function parseUploadedDocument(
  apiKey: string,
  fileName: string,
  bytes: Blob,
): Promise<DocumentParseResult> {
  const form = new FormData();
  form.set("file", bytes, fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`);
  form.set("options", JSON.stringify({
    formats: ["markdown"],
    timeout: FIRECRAWL_PARSE_TIMEOUT_MS,
    parsers: [{ type: "pdf", mode: "auto", maxPages: 20 }],
  }));
  try {
    const response = await fetch(`${FIRECRAWL_API}/parse`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await parseFirecrawlResponse(response);
  } catch (error) {
    return networkParseFailure(error);
  }
}

export function classifyFirecrawlParseFailure(status: number, body: string): Omit<DocumentParseResult, "markdown"> {
  if (isPasswordParseError(status, body)) {
    return { passwordProtected: true, retryable: false, error: "This PDF is password-protected." };
  }
  if (status === 401 || status === 403) {
    return {
      passwordProtected: false,
      retryable: false,
      error: "PDF reading is unavailable because Firecrawl authorization failed. Ask an administrator to check the integration.",
    };
  }
  if (status === 402) {
    return {
      passwordProtected: false,
      retryable: false,
      error: "PDF reading is unavailable because the Firecrawl account has no remaining credits.",
    };
  }
  if (status === 400 || status === 404 || status === 413 || status === 415 || status === 422) {
    return {
      passwordProtected: false,
      retryable: false,
      error: "This PDF could not be parsed. Its link may be expired, too large, or unsupported.",
    };
  }
  if (status === 408 || status === 429 || status >= 500) {
    return {
      passwordProtected: false,
      retryable: true,
      error: status === 429
        ? "PDF reading is temporarily rate-limited. Try again in a moment."
        : "PDF reading is temporarily unavailable. Try again.",
    };
  }
  return { passwordProtected: false, retryable: false, error: `PDF reading failed (${status}).` };
}

async function parseFirecrawlResponse(response: Response): Promise<DocumentParseResult> {
  const body = await response.text();
  if (!response.ok) return { markdown: "", ...classifyFirecrawlParseFailure(response.status, body) };
  try {
    const markdown = parseMarkdownFromFirecrawl(JSON.parse(body) as unknown);
    return markdown
      ? { markdown, passwordProtected: false, retryable: false, error: "" }
      : {
        markdown: "",
        passwordProtected: false,
        retryable: false,
        error: "This PDF did not contain readable text.",
      };
  } catch {
    return {
      markdown: "",
      passwordProtected: false,
      retryable: true,
      error: "The PDF reader returned an unreadable response. Try again.",
    };
  }
}

function networkParseFailure(error: unknown): DocumentParseResult {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  const timedOut = name === "AbortError" || name === "TimeoutError";
  return {
    markdown: "",
    passwordProtected: false,
    retryable: true,
    error: timedOut
      ? "PDF reading timed out. Try again; scanned documents can take longer."
      : "PDF reading could not reach Firecrawl. Try again.",
  };
}
