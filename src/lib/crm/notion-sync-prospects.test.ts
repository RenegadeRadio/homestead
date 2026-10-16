import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CrmProspectEntry, Store } from "@/lib/types";

const storeMocks = vi.hoisted(() => ({
  getStore: vi.fn(),
  updateStore: vi.fn(),
}));

vi.mock("@/lib/store", () => storeMocks);

import { syncProspectEntry, syncProspects } from "@/lib/crm/notion-sync";

const token = "secret-notion-token";

function prospect(overrides: Partial<CrmProspectEntry> = {}): CrmProspectEntry {
  return {
    id: "prospect_1",
    at: "2026-09-20T10:00:00.000Z",
    botId: "bot_1",
    name: "Ada Lovelace",
    profileUrl: "https://www.linkedin.com/in/ada-lovelace/",
    slug: "ada-lovelace",
    lane: "B",
    source: "inbound",
    status: "connected",
    note: "Accepted an inbound connection request.",
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
    return response({});
  });
}

describe("Notion CRM prospect sync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a prospect row with its fields and exact not-contacted note", async () => {
    const fetchFn = creationFetch();

    await expect(
      syncProspectEntry(prospect(), {
        fetchFn,
        env: { CREW_NOTION_TOKEN: token },
        rows: [],
      })
    ).resolves.toEqual({ state: "synced", detail: "row created" });

    const pageCall = fetchFn.mock.calls.find(
      ([input, init]) => String(input) === "https://api.notion.com/v1/pages" && init?.method === "POST"
    );
    const properties = JSON.parse(String(pageCall?.[1]?.body)).properties;
    expect(properties.Lane.select.name).toBe("B");
    expect(properties.Source.select.name).toBe("inbound");
    expect(properties.Status.select.name).toBe("connected");

    const noteCall = fetchFn.mock.calls.find(([input]) =>
      String(input).includes("/blocks/created_1/children")
    );
    const noteBody = JSON.parse(String(noteCall?.[1]?.body));
    expect(noteBody.children[0].paragraph.rich_text[0].text.content).toBe(
      "PROSPECT RECORDED, NOT CONTACTED: Accepted an inbound connection request."
    );
  });

  it("marks a created prospect synced so a second run creates nothing", async () => {
    const store = { crmProspects: [prospect()] } as Store;
    storeMocks.getStore.mockResolvedValue(store);
    storeMocks.updateStore.mockImplementation(async (fn: (value: Store) => unknown) => fn(store));
    const fetchFn = creationFetch();

    await syncProspects({ fetchFn, env: { CREW_NOTION_TOKEN: token } });
    expect(store.crmProspects?.[0].syncedAt).toBeDefined();
    const pageCallsAfterFirstRun = fetchFn.mock.calls.filter(
      ([input, init]) => String(input) === "https://api.notion.com/v1/pages" && init?.method === "POST"
    ).length;

    await syncProspects({ fetchFn, env: { CREW_NOTION_TOKEN: token } });
    expect(pageCallsAfterFirstRun).toBe(1);
    expect(fetchFn.mock.calls.filter(
      ([input, init]) => String(input) === "https://api.notion.com/v1/pages" && init?.method === "POST"
    )).toHaveLength(1);
  });

  it("skips an existing slug without writing to that row", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => response({}));

    await expect(
      syncProspectEntry(prospect(), {
        fetchFn,
        env: { CREW_NOTION_TOKEN: token },
        rows: [{
          pageId: "existing_1",
          status: "messaged",
          linkedin: "https://linkedin.com/in/ada-lovelace/?trk=public_profile",
        }],
      })
    ).resolves.toEqual({ state: "skipped", detail: "row already exists" });

    expect(fetchFn).not.toHaveBeenCalled();
  });
});
