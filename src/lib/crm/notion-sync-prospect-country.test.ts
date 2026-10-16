import { describe, expect, it, vi } from "vitest";

import type { CrmProspectEntry } from "@/lib/types";

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(),
  updateStore: vi.fn(),
}));

import { syncProspectEntry } from "@/lib/crm/notion-sync";

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
    if (url === "https://api.notion.com/v1/pages" && init?.method === "POST") {
      return response({ id: "created_1" });
    }
    return response({});
  });
}

async function createdProperties(entry: CrmProspectEntry) {
  const fetchFn = creationFetch();
  await syncProspectEntry(entry, {
    fetchFn,
    env: { CREW_NOTION_TOKEN: "secret-notion-token" },
    rows: [],
  });
  const creationCall = fetchFn.mock.calls.find(
    ([input, init]) =>
      String(input) === "https://api.notion.com/v1/pages" && init?.method === "POST"
  );
  return JSON.parse(String(creationCall?.[1]?.body)).properties as Record<string, unknown>;
}

describe("Notion prospect country", () => {
  it("writes a carried country to the Country property", async () => {
    const properties = await createdProperties(prospect({ country: "South Africa" }));

    expect(properties.Country).toEqual({
      rich_text: [{ type: "text", text: { content: "South Africa" } }],
    });
  });

  it("sends no Country property when the prospect has no country", async () => {
    const properties = await createdProperties(prospect());

    expect(properties).not.toHaveProperty("Country");
  });
});
