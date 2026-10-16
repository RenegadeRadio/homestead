const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function extractTitle(html: string) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? htmlToText(m[1]).slice(0, 200) : "";
}

function decodeDdg(href: string) {
  try {
    const normalized = href.replace(/&amp;/g, "&");
    const u = normalized.startsWith("//") ? `https:${normalized}` : normalized;
    const url = new URL(u);
    const uddg = url.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : u;
  } catch {
    return href;
  }
}

export async function fetchUrl(url: string, max = 24_000) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  const ctype = res.headers.get("content-type") || "";
  const raw = await res.text();
  if (ctype.includes("html") || raw.trim().startsWith("<")) {
    const title = extractTitle(raw) || url;
    const text = htmlToText(raw).slice(0, max);
    return { url: res.url || url, title, text, status: res.status };
  }
  return {
    url: res.url || url,
    title: url,
    text: raw.slice(0, max),
    status: res.status,
  };
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

async function searchDuckDuckGo(query: string): Promise<SearchHit[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const html = await res.text();
  if (html.includes("bots use DuckDuckGo too") || html.includes("anomaly-modal")) {
    throw new Error(
      "Search is unavailable: DuckDuckGo is showing its bot check. Results are unknown, not empty.",
    );
  }
  if (res.status !== 200) {
    throw new Error(
      `Search is unavailable: DuckDuckGo answered HTTP ${res.status}. Results are unknown, not empty.`,
    );
  }
  const hits: SearchHit[] = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < 8) {
    const href = decodeDdg(m[1]);
    if (!/^https?:\/\//i.test(href)) continue;
    hits.push({
      url: href,
      title: htmlToText(m[2]).slice(0, 180),
      snippet: "",
    });
  }
  const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)/gi;
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) && snippets.length < 8) {
    snippets.push(htmlToText(m[1]).slice(0, 280));
  }
  hits.forEach((hit, i) => {
    if (snippets[i]) hit.snippet = snippets[i];
  });
  return hits;
}

class BraveSearchError extends Error {}

async function searchBrave(query: string, key: string): Promise<SearchHit[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "8");

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "X-Subscription-Token": key,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new BraveSearchError("could not be reached");
  }

  if (res.status !== 200) {
    throw new BraveSearchError(`answered HTTP ${res.status}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new BraveSearchError("returned an invalid response");
  }

  const results = (body as { web?: { results?: unknown } } | null)?.web?.results;
  if (!Array.isArray(results)) {
    throw new BraveSearchError("answered without web results");
  }

  const hits: SearchHit[] = [];
  for (const result of results) {
    if (!result || typeof result !== "object") continue;
    const item = result as { title?: unknown; url?: unknown; description?: unknown };
    if (typeof item.url !== "string" || !/^https?:\/\//i.test(item.url)) continue;
    hits.push({
      title: htmlToText(String(item.title ?? "")).slice(0, 180),
      url: item.url,
      snippet: htmlToText(String(item.description ?? "")).slice(0, 280),
    });
    if (hits.length === 8) break;
  }
  return hits;
}

function duckDuckGoFailureReason(error: unknown) {
  if (!(error instanceof Error)) return "could not be reached";
  if (error.message.includes("bot check")) return "showed its bot check";
  const status = error.message.match(/answered HTTP (\d+)/)?.[1];
  return status ? `answered HTTP ${status}` : "could not be reached";
}

export async function webSearch(query: string): Promise<SearchHit[]> {
  try {
    return await searchDuckDuckGo(query);
  } catch (duckDuckGoError) {
    const key = process.env.BRAVE_API_KEY?.trim();
    if (!key) throw duckDuckGoError;

    try {
      return await searchBrave(query, key);
    } catch (braveError) {
      const braveReason =
        braveError instanceof BraveSearchError ? braveError.message : "could not be reached";
      throw new Error(
        `Search is unavailable: DuckDuckGo ${duckDuckGoFailureReason(duckDuckGoError)} and Brave ${braveReason}. Results are unknown, not empty.`,
      );
    }
  }
}
