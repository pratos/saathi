import { FirecrawlClient, type SearchResponse } from "@firecrawl/firecrawl-convex";
import { components } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";

const firecrawl = new FirecrawlClient(components.firecrawl);

export async function searchPublicWeb(ctx: ActionCtx, query: string) {
  const result = await firecrawl.search(ctx, query.trim(), {
    sources: ["news", "web"],
    limit: 4,
    highlights: true,
    scrapeOptions: { formats: ["markdown"], onlyMainContent: true, maxAge: 15 * 60 * 1000 },
  });
  return formatPublicWebResults(result);
}

export function formatPublicWebResults(result: SearchResponse) {
  const entries = [...(result.news ?? []), ...(result.web ?? [])].slice(0, 6);
  if (entries.length === 0) return "No relevant public web results were found.";
  return entries.map((entry, index) => {
    const metadata = "metadata" in entry && entry.metadata && typeof entry.metadata === "object"
      ? entry.metadata as Record<string, unknown> : undefined;
    const title = cleanText(("title" in entry ? entry.title : undefined) ?? metadata?.title) || `Source ${index + 1}`;
    const url = cleanText(("url" in entry ? entry.url : undefined) ?? metadata?.url ?? metadata?.sourceURL);
    const excerpt = cleanText(
      ("markdown" in entry ? entry.markdown : undefined) ??
      ("description" in entry ? entry.description : undefined) ??
      ("summary" in entry ? entry.summary : undefined),
    ).slice(0, 2_500);
    return [`Source ${index + 1}: ${title}`, url && `URL: ${url}`, excerpt && `Evidence: ${excerpt}`].filter(Boolean).join("\n");
  }).join("\n\n").slice(0, 12_000);
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
