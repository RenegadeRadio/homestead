import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LinkedInSendEntry, Store } from "@/lib/types";

const storeMocks = vi.hoisted(() => ({
  getStore: vi.fn(),
  updateStore: vi.fn(),
}));

vi.mock("@/lib/store", () => storeMocks);

import {
  DEFAULT_DATABASE_ID,
  fetchCrmRows,
  syncPendingSends,
  syncSendEntry,
} from "@/lib/crm/notion-sync";

const token = "secret-notion-token";

function entry(overrides: Partial<LinkedInSendEntry> = {}): LinkedInSendEntry {
  return {
    id: "send_1",
    at: "2026-09-16T10:00:00.000Z",
    botId: "bot_1",
    conversationId: "conversation_1",
    messageId: "message_1",
    url: "https://www.linkedin.com/in/example-person/",
    slug: "example-person",
    action: "click",
    label: "Send",
    key: null,
    text: "Hello there",
    kind: "invite",
    ...overrides,
  };
}

function response(json: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  } as Response;
}

function row(id: string, status: string, linkedin = "https://linkedin.com/in/example-person") {
  return {
    id,
    properties: {
      Status: { select: { name: status } },
      LinkedIn: { url: linkedin },
    },
  };
}

function successfulFetch(status = "queued") {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({ results: [row("page_1", status)], has_more: false }))
    .mockResolvedValueOnce(response({ results: [], has_more: false }))
    .mockResolvedValue(response({}));
}

describe("Notion CRM send sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not request Notion without a configured token", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    await expect(syncSendEntry(entry(), { fetchFn, env: {} })).resolves.toEqual({
      state: "not-configured",
      detail: "",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("records an invite and updates queued status and Latest note", async () => {
    const fetchFn = successfulFetch();
    await expect(
      syncSendEntry(entry(), { fetchFn, env: { CREW_NOTION_TOKEN: token } })
    ).resolves.toEqual({ state: "synced", detail: "Status set to pending" });

    const append = fetchFn.mock.calls[3];
    expect(append[0]).toContain("/blocks/page_1/children");
    expect(append[1]?.method).toBe("PATCH");
    expect(append[1]?.body).toContain("send_1");
    const update = JSON.parse(String(fetchFn.mock.calls[2][1]?.body));
    expect(update.properties.Status.select.name).toBe("pending");
    expect(update.properties["Latest note"].rich_text[0].text.content).toBe("Hello there");
  });

  it("moves a held invite to pending", async () => {
    const fetchFn = successfulFetch("held");
    await expect(
      syncSendEntry(entry(), { fetchFn, env: { CREW_NOTION_TOKEN: token } })
    ).resolves.toEqual({ state: "synced", detail: "Status set to pending" });
    const update = JSON.parse(String(fetchFn.mock.calls[2][1]?.body));
    expect(update.properties.Status.select.name).toBe("pending");
  });

  it.each(["connected", "accepted", "awaiting DM", "follow-up due"])(
    "moves a message from %s to messaged",
    async (status) => {
      const fetchFn = successfulFetch(status);
      await expect(
        syncSendEntry(entry({ kind: "message" }), {
          fetchFn,
          env: { CREW_NOTION_TOKEN: token },
        })
      ).resolves.toEqual({ state: "synced", detail: "Status set to messaged" });
      const update = JSON.parse(String(fetchFn.mock.calls[2][1]?.body));
      expect(update.properties.Status.select.name).toBe("messaged");
    }
  );

  it("records null text as none and says the text is unknown in Latest note", async () => {
    const fetchFn = successfulFetch();
    await expect(
      syncSendEntry(entry({ text: null }), {
        fetchFn,
        env: { CREW_NOTION_TOKEN: token },
      })
    ).resolves.toEqual({ state: "synced", detail: "Status set to pending" });
    const update = JSON.parse(String(fetchFn.mock.calls[2][1]?.body));
    const append = JSON.parse(String(fetchFn.mock.calls[3][1]?.body));
    expect(update.properties.Status).toBeDefined();
    expect(update.properties["Latest note"].rich_text[0].text.content).toBe(
      "Invite sent 2026-09-16; Homestead recorded no text."
    );
    expect(append.children[0].paragraph.rich_text[0].text.content).toMatch(/Text: none$/);
  });

  it("records a message and moves a pending row to messaged", async () => {
    const fetchFn = successfulFetch("pending");
    const result = await syncSendEntry(entry({ kind: "message" }), {
      fetchFn,
      env: { CREW_NOTION_TOKEN: token },
    });
    expect(result).toEqual({ state: "synced", detail: "Status set to messaged" });
    const update = JSON.parse(String(fetchFn.mock.calls[2][1]?.body));
    expect(update.properties.Status.select.name).toBe("messaged");
    expect(update.properties["Latest note"].rich_text[0].text.content).toBe("Hello there");
  });

  it("does not write when the send id is already in a child block", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ results: [row("page_1", "queued")] }))
      .mockResolvedValueOnce(
        response({
          results: [
            {
              type: "paragraph",
              paragraph: { rich_text: [{ plain_text: "Already has send_1 here" }] },
            },
          ],
        })
      );
    await expect(
      syncSendEntry(entry(), { fetchFn, env: { CREW_NOTION_TOKEN: token } })
    ).resolves.toEqual({ state: "synced", detail: "already recorded" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("finds an existing send id on the second child-block page", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ results: [row("page_1", "queued")], has_more: false }))
      .mockResolvedValueOnce(
        response({
          results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "other" }] } }],
          has_more: true,
          next_cursor: "cursor-2",
        })
      )
      .mockResolvedValueOnce(
        response({
          results: [
            { type: "paragraph", paragraph: { rich_text: [{ plain_text: "contains send_1" }] } },
          ],
          has_more: false,
        })
      );
    await expect(
      syncSendEntry(entry(), { fetchFn, env: { CREW_NOTION_TOKEN: token } })
    ).resolves.toEqual({ state: "synced", detail: "already recorded" });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(String(fetchFn.mock.calls[2][0])).toContain("start_cursor=cursor-2");
  });

  it("uses the token file and required headers on every request", async () => {
    const fetchFn = successfulFetch();
    const readFile = vi.fn().mockReturnValue("  file-token\n");
    await syncSendEntry(entry(), {
      fetchFn,
      env: { CREW_NOTION_TOKEN_FILE: "/tmp/token" },
      readFile,
    });
    expect(readFile).toHaveBeenCalledWith("/tmp/token", "utf8");
    for (const [, init] of fetchFn.mock.calls) {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer file-token");
      expect(headers["Notion-Version"]).toBe("2022-06-28");
    }
  });

  it("uses the default database id unless it is overridden", async () => {
    const defaultFetch = successfulFetch();
    await syncSendEntry(entry(), { fetchFn: defaultFetch, env: { CREW_NOTION_TOKEN: token } });
    expect(defaultFetch.mock.calls[0][0]).toBe(
      `https://api.notion.com/v1/databases/${DEFAULT_DATABASE_ID}/query`
    );

    const overrideFetch = successfulFetch();
    await syncSendEntry(entry(), {
      fetchFn: overrideFetch,
      env: { CREW_NOTION_TOKEN: token, CREW_NOTION_CRM_DATABASE_ID: "other-db" },
    });
    expect(overrideFetch.mock.calls[0][0]).toBe(
      "https://api.notion.com/v1/databases/other-db/query"
    );
  });

  it("does not write for missing or ambiguous rows", async () => {
    const noRowFetch = vi.fn<typeof fetch>().mockResolvedValue(response({ results: [] }));
    await expect(
      syncSendEntry(entry(), {
        fetchFn: noRowFetch,
        env: { CREW_NOTION_TOKEN: token },
      })
    ).resolves.toMatchObject({ state: "no-row" });
    expect(noRowFetch).toHaveBeenCalledTimes(1);

    const ambiguousFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ results: [row("one", "queued"), row("two", "held")] }));
    await expect(
      syncSendEntry(entry(), {
        fetchFn: ambiguousFetch,
        env: { CREW_NOTION_TOKEN: token },
      })
    ).resolves.toMatchObject({ state: "ambiguous" });
    expect(ambiguousFetch).toHaveBeenCalledTimes(1);
  });

  it("reports request status and redacts the token from failures", async () => {
    const statusFetch = vi.fn<typeof fetch>().mockResolvedValue(response({}, 503));
    const statusResult = await syncSendEntry(entry(), {
      fetchFn: statusFetch,
      env: { CREW_NOTION_TOKEN: token },
    });
    expect(statusResult.state).toBe("failed");
    expect(statusResult.detail).toContain("503");

    const leakingFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error(`failure ${token}`));
    const leakingResult = await syncSendEntry(entry(), {
      fetchFn: leakingFetch,
      env: { CREW_NOTION_TOKEN: token },
    });
    expect(leakingResult.detail).not.toContain(token);
    expect(leakingResult.detail).toContain("[redacted]");
  });

  it("saves unsynced and failed results while leaving synced entries alone", async () => {
    const unsynced = entry({ id: "unsynced", slug: null });
    const synced = entry({
      id: "synced",
      crmSync: { state: "synced", detail: "done", at: "earlier" },
    });
    const retry = entry({
      id: "retry",
      slug: null,
      crmSync: { state: "failed", detail: "failed", at: "earlier" },
    });
    const store = { linkedinSendLog: [unsynced, synced, retry] } as Store;
    storeMocks.getStore.mockResolvedValue(store);
    storeMocks.updateStore.mockImplementation(async (fn: (value: Store) => unknown) => fn(store));

    const counts = await syncPendingSends({
      fetchFn: vi.fn<typeof fetch>(),
      env: { CREW_NOTION_TOKEN: token },
    });
    expect(counts.skipped).toBe(2);
    expect(unsynced.crmSync?.state).toBe("skipped");
    expect(retry.crmSync?.state).toBe("skipped");
    expect(synced.crmSync).toEqual({ state: "synced", detail: "done", at: "earlier" });
    expect(storeMocks.updateStore).toHaveBeenCalledTimes(1);
  });

  it("retries no-row and not-configured while preserving ambiguous and skipped", async () => {
    const retryA = entry({
      id: "retry-a", slug: "retry-a", url: "https://linkedin.com/in/retry-a",
      crmSync: { state: "no-row", detail: "", at: "earlier" },
    });
    const retryB = entry({
      id: "retry-b", slug: "retry-b", url: "https://linkedin.com/in/retry-b",
      crmSync: { state: "not-configured", detail: "", at: "earlier" },
    });
    const staleA = entry({
      id: "stale-a", slug: "stale-a", url: "https://linkedin.com/in/stale-a",
      crmSync: { state: "ambiguous", detail: "", at: "earlier" },
    });
    const staleB = entry({
      id: "stale-b", slug: "stale-b", url: "https://linkedin.com/in/stale-b",
      crmSync: { state: "skipped", detail: "", at: "earlier" },
    });
    const store = { linkedinSendLog: [retryA, retryB, staleA, staleB] } as Store;
    storeMocks.getStore.mockResolvedValue(store);
    storeMocks.updateStore.mockImplementation(async (fn: (value: Store) => unknown) => fn(store));
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/databases/")) {
        return response({
          results: [
            row("page-a", "queued", retryA.url),
            row("page-b", "queued", retryB.url),
          ],
          has_more: false,
        });
      }
      if (url.includes("/blocks/") && init?.method === "GET") {
        return response({ results: [], has_more: false });
      }
      return response({});
    });
    await expect(
      syncPendingSends({ fetchFn, env: { CREW_NOTION_TOKEN: token } })
    ).resolves.toEqual({
      "not-configured": 0, skipped: 0, "no-row": 0, ambiguous: 0, synced: 2, failed: 0,
    });
    expect(retryA.crmSync?.state).toBe("synced");
    expect(retryB.crmSync?.state).toBe("synced");
    expect(staleA.crmSync).toEqual({ state: "ambiguous", detail: "", at: "earlier" });
    expect(staleB.crmSync).toEqual({ state: "skipped", detail: "", at: "earlier" });
  });

  it("fans a database failure out to slugged entries and skips entries without slugs", async () => {
    const first = entry({ id: "with-slug-a", slug: "with-slug-a" });
    const second = entry({ id: "with-slug-b", slug: "with-slug-b" });
    const noSlug = entry({ id: "no-slug", slug: null });
    const store = { linkedinSendLog: [first, second, noSlug] } as Store;
    storeMocks.getStore.mockResolvedValue(store);
    storeMocks.updateStore.mockImplementation(async (fn: (value: Store) => unknown) => fn(store));
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response({}, 500));
    await syncPendingSends({ fetchFn, env: { CREW_NOTION_TOKEN: token } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(first.crmSync).toMatchObject({ state: "failed", detail: expect.stringContaining("500") });
    expect(second.crmSync).toMatchObject({ state: "failed", detail: expect.stringContaining("500") });
    expect(noSlug.crmSync?.state).toBe("skipped");
  });

  it("does not query the database when all pending entries lack slugs", async () => {
    const store = { linkedinSendLog: [entry({ slug: null })] } as Store;
    storeMocks.getStore.mockResolvedValue(store);
    storeMocks.updateStore.mockImplementation(async (fn: (value: Store) => unknown) => fn(store));
    const fetchFn = vi.fn<typeof fetch>();
    await syncPendingSends({ fetchFn, env: { CREW_NOTION_TOKEN: token } });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reads all pages using next_cursor", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ results: [row("one", "queued")], has_more: true, next_cursor: "next" })
      )
      .mockResolvedValueOnce(response({ results: [row("two", "held")], has_more: false }));
    const rows = await fetchCrmRows({ token, databaseId: "database", fetchFn });
    expect(rows.map(({ pageId }) => pageId)).toEqual(["one", "two"]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1][1]?.body).toBe(JSON.stringify({ start_cursor: "next" }));
  });

  it("retries the status write before recording the send paragraph", async () => {
    const paragraphs: string[] = [];
    let pageUpdates = 0;
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/databases/")) {
        return response({ results: [row("page_1", "queued")], has_more: false });
      }
      if (url.endsWith("/blocks/page_1/children") && init?.method === "GET") {
        return response({
          results: paragraphs.map((text) => ({
            type: "paragraph",
            paragraph: { rich_text: [{ plain_text: text }] },
          })),
          has_more: false,
        });
      }
      if (url.endsWith("/pages/page_1")) {
        pageUpdates += 1;
        return response({}, pageUpdates === 1 ? 502 : 200);
      }
      if (url.endsWith("/blocks/page_1/children") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        paragraphs.push(body.children[0].paragraph.rich_text[0].text.content);
        return response({});
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const deps = { fetchFn, env: { CREW_NOTION_TOKEN: token } };

    await expect(syncSendEntry(entry(), deps)).resolves.toMatchObject({ state: "failed" });
    expect(paragraphs).toEqual([]);
    await expect(syncSendEntry(entry(), deps)).resolves.toEqual({
      state: "synced",
      detail: "Status set to pending",
    });
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toContain("send_1");
  });

  it("serializes overlapping pending-send syncs", async () => {
    const paragraphs: string[] = [];
    const pendingEntry = entry();
    const store = { linkedinSendLog: [pendingEntry] } as Store;
    storeMocks.getStore.mockImplementation(async () => store);
    storeMocks.updateStore.mockImplementation(async (fn: (value: Store) => unknown) => fn(store));
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/databases/")) {
        return response({ results: [row("page_1", "queued")], has_more: false });
      }
      if (url.endsWith("/blocks/page_1/children") && init?.method === "GET") {
        return response({ results: [], has_more: false });
      }
      if (url.endsWith("/blocks/page_1/children") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        paragraphs.push(body.children[0].paragraph.rich_text[0].text.content);
      }
      return response({});
    });
    const deps = { fetchFn, env: { CREW_NOTION_TOKEN: token } };

    await Promise.all([syncPendingSends(deps), syncPendingSends(deps)]);

    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toContain(pendingEntry.id);
  });

  it("reads the CRM database once for multiple pending sends", async () => {
    const entries = ["one", "two", "three"].map((slug, index) =>
      entry({ id: `send_${index + 1}`, slug, url: `https://linkedin.com/in/${slug}` })
    );
    const store = { linkedinSendLog: entries } as Store;
    storeMocks.getStore.mockResolvedValue(store);
    storeMocks.updateStore.mockImplementation(async (fn: (value: Store) => unknown) => fn(store));
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/databases/")) {
        return response({
          results: entries.map((item, index) =>
            row(`page_${index + 1}`, "queued", `https://linkedin.com/in/${item.slug}`)
          ),
          has_more: false,
        });
      }
      if (url.includes("/blocks/") && init?.method === "GET") {
        return response({ results: [], has_more: false });
      }
      return response({});
    });

    await syncPendingSends({ fetchFn, env: { CREW_NOTION_TOKEN: token } });

    expect(fetchFn.mock.calls.filter(([input]) => String(input).includes("/databases/"))).toHaveLength(1);
    expect(entries.map((item) => item.crmSync?.state)).toEqual(["synced", "synced", "synced"]);
  });

  it("finishes every request for one entry before starting the next", async () => {
    const entries = ["one", "two"].map((slug, index) =>
      entry({ id: `send_${index + 1}`, slug, url: `https://linkedin.com/in/${slug}` })
    );
    const store = { linkedinSendLog: entries } as Store;
    storeMocks.getStore.mockResolvedValue(store);
    storeMocks.updateStore.mockImplementation(async (fn: (value: Store) => unknown) => fn(store));
    const events: string[] = [];
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/databases/")) {
        return response({
          results: entries.map((item, index) =>
            row(`page_${index + 1}`, "queued", `https://linkedin.com/in/${item.slug}`)
          ),
          has_more: false,
        });
      }
      const page = url.includes("page_1") ? "page_1" : "page_2";
      events.push(`start:${page}:${init?.method}`);
      await Promise.resolve();
      events.push(`end:${page}:${init?.method}`);
      return url.includes("/blocks/") && init?.method === "GET"
        ? response({ results: [], has_more: false })
        : response({});
    });

    await syncPendingSends({ fetchFn, env: { CREW_NOTION_TOKEN: token } });

    const firstSecondEntryRequest = events.findIndex((event) => event.startsWith("start:page_2"));
    const lastFirstEntryCompletion = events.findLastIndex((event) => event.startsWith("end:page_1"));
    expect(firstSecondEntryRequest).toBeGreaterThan(lastFirstEntryCompletion);
  });

  it("uses the configured database id for its own CRM read", async () => {
    const runWith = async (env: Record<string, string>) => {
      const store = { linkedinSendLog: [entry()] } as Store;
      storeMocks.getStore.mockResolvedValue(store);
      storeMocks.updateStore.mockImplementation(async (fn: (value: Store) => unknown) => fn(store));
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(response({ results: [], has_more: false }));

      await syncPendingSends({
        fetchFn,
        env: { CREW_NOTION_TOKEN: token, ...env },
      });

      return String(fetchFn.mock.calls[0][0]);
    };

    await expect(runWith({})).resolves.toBe(
      `https://api.notion.com/v1/databases/${DEFAULT_DATABASE_ID}/query`
    );
    await expect(runWith({ CREW_NOTION_CRM_DATABASE_ID: "other-db" })).resolves.toBe(
      "https://api.notion.com/v1/databases/other-db/query"
    );
  });
});
