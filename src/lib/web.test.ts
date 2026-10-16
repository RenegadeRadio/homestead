import { afterEach, describe, expect, it, vi } from "vitest";

import { webSearch } from "@/lib/web";

describe("webSearch", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubSearchResponse(status: number, body: string) {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status,
      text: async () => body,
    })));
  }

  it("rejects when DuckDuckGo shows its bot check", async () => {
    stubSearchResponse(
      200,
      '<div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div>',
    );

    await expect(webSearch("blocked query")).rejects.toThrow(/^Search is unavailable/);
  });

  it("rejects when DuckDuckGo returns a non-200 status", async () => {
    stubSearchResponse(202, "<html>whatever</html>");

    await expect(webSearch("blocked query")).rejects.toThrow(/Search is unavailable.*202/);
  });

  it("returns decoded target URLs for search results", async () => {
    stubSearchResponse(
      200,
      [
        '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone&amp;rest=1">One</a>',
        '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Ftwo&amp;rest=1">Two</a>',
      ].join(""),
    );

    const hits = await webSearch("working query");

    expect(hits).toHaveLength(2);
    expect(hits.map((hit) => hit.url)).toEqual([
      "https://example.com/one",
      "https://example.org/two",
    ]);
  });

  it("returns an empty array for a normal page without results", async () => {
    stubSearchResponse(200, "<html><body>No matches</body></html>");

    await expect(webSearch("empty query")).resolves.toEqual([]);
  });
});

describe("webSearch Brave fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const botCheck = '<div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div>';

  it("returns Brave results after the DuckDuckGo bot check", async () => {
    const key = "secret-key-123";
    vi.stubEnv("BRAVE_API_KEY", key);
    const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      if (String(input).includes("duckduckgo")) {
        return { status: 200, text: async () => botCheck };
      }
      return {
        status: 200,
        json: async () => ({
          web: {
            results: [
              { title: "<b>One</b>", url: "https://example.com/one", description: "First <b>hit</b>" },
              { title: "Two", url: "https://example.org/two", description: "Second hit" },
            ],
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(webSearch("fallback query")).resolves.toEqual([
      { title: "One", url: "https://example.com/one", snippet: "First hit" },
      { title: "Two", url: "https://example.org/two", snippet: "Second hit" },
    ]);
    const braveCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("api.search.brave.com"),
    );
    expect(braveCall?.[1]?.headers).toMatchObject({ "X-Subscription-Token": key });
  });

  it("reports both providers without exposing the key when Brave rejects", async () => {
    const key = "secret-key-456";
    vi.stubEnv("BRAVE_API_KEY", key);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) =>
      String(input).includes("duckduckgo")
        ? { status: 200, text: async () => botCheck }
        : { status: 429, json: async () => ({}) },
    ));

    const error = await webSearch("limited query").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected webSearch to reject with an Error");
    expect(error.message).toMatch(/^Search is unavailable:/);
    expect(error.message).toContain("DuckDuckGo");
    expect(error.message).toContain("Brave");
    expect(error.message).not.toContain(key);
  });

  it("returns an empty array for an empty Brave results list", async () => {
    vi.stubEnv("BRAVE_API_KEY", "secret-key-789");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) =>
      String(input).includes("duckduckgo")
        ? { status: 200, text: async () => botCheck }
        : { status: 200, json: async () => ({ web: { results: [] } }) },
    ));

    await expect(webSearch("empty fallback query")).resolves.toEqual([]);
  });

  it("does not try Brave when its API key is empty", async () => {
    vi.stubEnv("BRAVE_API_KEY", "");
    const fetchMock = vi.fn(async () => ({ status: 200, text: async () => botCheck }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(webSearch("blocked query")).rejects.toThrow(
      "Search is unavailable: DuckDuckGo is showing its bot check. Results are unknown, not empty.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not try Brave when DuckDuckGo succeeds", async () => {
    vi.stubEnv("BRAVE_API_KEY", "secret-key-abc");
    const fetchMock = vi.fn(async (input: string | URL) => {
      void input;
      return {
        status: 200,
        text: async () =>
          '<a class="result__a" href="https://example.com/from-ddg">DuckDuckGo result</a>',
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(webSearch("working query")).resolves.toEqual([
      { title: "DuckDuckGo result", url: "https://example.com/from-ddg", snippet: "" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("duckduckgo");
  });
});
