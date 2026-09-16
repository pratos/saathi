import { isPasswordParseError, parseMarkdownFromFirecrawl } from "./inboxExtract";

const FIRECRAWL_API = "https://api.firecrawl.dev/v2";

export async function parsePublicDocument(apiKey: string, url: string) {
  const response = await fetch(`${FIRECRAWL_API}/scrape`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      timeout: 30_000,
      parsers: [{ type: "pdf", mode: "auto", maxPages: 20 }],
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    return {
      markdown: "",
      passwordProtected: isPasswordParseError(response.status, body),
      error: body.slice(0, 400),
    };
  }
  try {
    return {
      markdown: parseMarkdownFromFirecrawl(JSON.parse(body) as unknown),
      passwordProtected: false,
      error: "",
    };
  } catch {
    return { markdown: "", passwordProtected: false, error: "Firecrawl returned an unreadable document." };
  }
}
