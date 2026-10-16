import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LinkedInSendEntry, Store } from "@/lib/types";

const storeMocks = vi.hoisted(() => ({
  getStore: vi.fn(),
  updateStore: vi.fn(),
}));

vi.mock("@/lib/store", () => storeMocks);

import { syncPendingSends, syncSendEntry } from "@/lib/crm/notion-sync";

const token = "secret-notion-token";

function entry(overrides: Partial<LinkedInSendEntry> = {}): LinkedInSendEntry {
  return {
    id: "send_1",
    at: "2026-09-18T10:00:00.000Z",
    botId: "bot_1",
    conversationId: "conversation_1",
    messageId: "message_1",
    url: "https://www.linkedin.com/in/jane-smith/",
    slug: "jane-smith",
    action: "click",
    label: "Send",
    key: null,
    text: "Hello",
    kind: "message",
    ...overrides,
  };
}

function response(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as Response;
}

function creationFetch() {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.includes("/databases/")) return response({ results: [], has_more: false });
    if (url === "https://api.notion.com/v1/pages" && init?.method === "POST") {
      return response({ id: "created_1" });
    }
    if (url.includes("/blocks/") && init?.method === "GET") {
      return response({ results: [], has_more: false });
    }
    return response({});
  });
}

function creationBody(fetchFn: ReturnType<typeof creationFetch>) {
  const call = fetchFn.mock.calls.find(
    ([input, init]) => String(input) === "https://api.notion.com/v1/pages" && init?.method === "POST"
  );
  expect(call).toBeDefined();
  return JSON.parse(String(call?.[1]?.body));
}

describe("Notion CRM row creation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a lane A message row with the supplied name", async () => {
    const fetchFn = creationFetch();
    await expect(
      syncSendEntry(
        entry({ lane: "A" }),
        { fetchFn, env: { CREW_NOTION_TOKEN: token }, rows: [] },
        { name: "Jane Smith" }
      )
    ).resolves.toEqual({ state: "synced", detail: "row created" });

    const { properties } = creationBody(fetchFn);
    expect(properties.Name.title[0].text.content).toBe("Jane Smith");
    expect(properties.Lane.select.name).toBe("A");
    expect(properties.Status.select.name).toBe("messaged");
    expect(properties.Source.select.name).toBe("linkedin");
    expect(properties.LinkedIn.url).toContain("jane-smith");
  });

  it("creates a lane B invite row as pending", async () => {
    const fetchFn = creationFetch();
    await syncSendEntry(entry({ lane: "B", kind: "invite" }), {
      fetchFn,
      env: { CREW_NOTION_TOKEN: token },
      rows: [],
    });
    expect(creationBody(fetchFn).properties.Status.select.name).toBe("pending");
  });

  it("does not create a row for a message without a lane", async () => {
    const fetchFn = creationFetch();
    await expect(
      syncSendEntry(entry(), {
        fetchFn,
        env: { CREW_NOTION_TOKEN: token },
        rows: [],
      })
    ).resolves.toEqual({ state: "no-row", detail: "" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("creates one page for two lane-tagged sends to the same new slug", async () => {
    const store = {
      linkedinSendLog: [
        entry({ id: "send_1", lane: "A", kind: "invite" }),
        entry({ id: "send_2", lane: "A", kind: "message" }),
      ],
    } as Store;
    storeMocks.getStore.mockResolvedValue(store);
    storeMocks.updateStore.mockImplementation(async (fn: (value: Store) => unknown) => fn(store));
    const fetchFn = creationFetch();

    await syncPendingSends({ fetchFn, env: { CREW_NOTION_TOKEN: token } });

    expect(
      fetchFn.mock.calls.filter(([input]) => String(input) === "https://api.notion.com/v1/pages")
    ).toHaveLength(1);
  });

  it("uses the matching Outbox item's name", async () => {
    const store = {
      outbox: [{
        id: "item_1",
        name: "Alex Doe",
        profileUrl: "https://www.linkedin.com/in/jane-smith/",
        text: "Hello",
        status: "sent",
        lane: "A",
        createdAt: "2026-09-18T09:00:00.000Z",
        createdBy: "operator",
      }],
      linkedinSendLog: [entry({ lane: "A", outboxItemId: "item_1" })],
    } as Store;
    storeMocks.getStore.mockResolvedValue(store);
    storeMocks.updateStore.mockImplementation(async (fn: (value: Store) => unknown) => fn(store));
    const fetchFn = creationFetch();

    await syncPendingSends({ fetchFn, env: { CREW_NOTION_TOKEN: token } });

    expect(creationBody(fetchFn).properties.Name.title[0].text.content).toBe("Alex Doe");
  });
});
