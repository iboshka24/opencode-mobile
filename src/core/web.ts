const MAX_CHARS = 30_000;

export function clip(text: string, max = MAX_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n(truncated, ${text.length - max} characters omitted)`;
}

export function htmlToMarkdown(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  text = text
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<(?:br|\/p|\/div|\/tr|\/h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text).replace(/\n{3,}/g, "\n\n").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export function parseDuckDuckGo(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const link = /<a[^>]*class="[^"]*result-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = [...html.matchAll(/<(?:td|span)[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:td|span)>/gi)].map(
    (match) => htmlToMarkdown(match[1] ?? ""),
  );
  let index = 0;
  for (const match of html.matchAll(link)) {
    const url = decodeEntities(match[1] ?? "");
    if (!url.startsWith("http")) continue;
    hits.push({
      title: htmlToMarkdown(match[2] ?? "") || url,
      url,
      snippet: snippets[index] ?? "",
    });
    index += 1;
    if (hits.length >= 8) break;
  }
  return hits;
}

export async function fetchWeb(
  url: string,
  format: "markdown" | "text" | "html",
  signal?: AbortSignal,
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL must be an absolute http or https URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must use http:// or https://");
  }
  const accept =
    format === "html"
      ? "text/html, */*;q=0.1"
      : format === "text"
        ? "text/plain, text/markdown;q=0.9, text/html;q=0.8"
        : "text/markdown, text/html;q=0.8, text/plain;q=0.7";
  const response = await fetch(url, {
    signal,
    redirect: "follow",
    headers: {
      Accept: accept,
      "User-Agent": "Mozilla/5.0 (compatible; OpenCode-User/1.0; +https://opencode.ai)",
    },
  });
  if (!response.ok) throw new Error(`webfetch failed: HTTP ${response.status} for ${url}`);
  const body = await response.text();
  const type = response.headers.get("content-type") ?? "";
  if (format === "html") return clip(body);
  if (format === "markdown" && (type.includes("html") || body.trimStart().startsWith("<"))) {
    return clip(htmlToMarkdown(body));
  }
  return clip(body);
}

export async function searchWeb(query: string, braveKey?: string, signal?: AbortSignal): Promise<string> {
  if (!query.trim()) throw new Error("query must not be empty");
  if (braveKey) {
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, {
      signal,
      headers: { Accept: "application/json", "X-Subscription-Token": braveKey },
    });
    if (!response.ok) throw new Error(`Brave search failed: HTTP ${response.status}`);
    const json = (await response.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
    const results = json.web?.results ?? [];
    if (results.length === 0) return "No search results found. Please try a different query.";
    return results
      .map((result, index) => `${index + 1}. ${result.title ?? ""}\n${result.url ?? ""}\n${result.description ?? ""}`)
      .join("\n\n");
  }
  const lite = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    signal,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; OpenCode-User/1.0; +https://opencode.ai)" },
  });
  if (lite.ok) {
    const hits = parseDuckDuckGo(await lite.text());
    if (hits.length) {
      return hits.map((hit, index) => `${index + 1}. ${hit.title}\n${hit.url}\n${hit.snippet}`).join("\n\n");
    }
  }
  const instant = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
    signal,
  });
  if (!instant.ok) {
    return `Web search failed (DuckDuckGo HTTP ${lite.status} / instant HTTP ${instant.status}). No companion search server is configured. Add a Brave API key in Settings or use webfetch on a known URL.`;
  }
  const json = (await instant.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
  };
  const lines: string[] = [];
  if (json.Heading || json.AbstractText) {
    lines.push(`${json.Heading ?? query}\n${json.AbstractURL ?? ""}\n${json.AbstractText ?? ""}`.trim());
  }
  for (const topic of json.RelatedTopics ?? []) {
    if (topic.Text && topic.FirstURL) lines.push(`${topic.Text}\n${topic.FirstURL}`);
    if (lines.length >= 8) break;
  }
  if (lines.length === 0) {
    return "No search results found. Please try a different query. DuckDuckGo returned an empty instant answer, and the HTML results page had no parseable links.";
  }
  return lines.join("\n\n");
}
