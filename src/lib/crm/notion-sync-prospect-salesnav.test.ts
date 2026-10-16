import { describe, expect, it, vi } from "vitest";

import type { CrmProspectEntry } from "@/lib/types";

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(),
  updateStore: vi.fn(),
}));

import { syncProspectEntry } from "@/lib/crm/notion-sync";

const token = "secret-notion-token";
const salesNavUrl =
  "https://www.linkedin.com/sales/lead/ACwAAA0000000000000000000000000000000000";

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

async function createdNote(entry: CrmProspectEntry) {
  const fetchFn = creationFetch();
  await syncProspectEntry(entry, {
    fetchFn,
    env: { CREW_NOTION_TOKEN: token },
    rows: [],
  });
  const noteCall = fetchFn.mock.calls.find(([input]) =>
    String(input).includes("/blocks/created_1/children")
  );
  return JSON.parse(String(noteCall?.[1]?.body)).children[0].paragraph.rich_text[0].text
    .content as string;
}

describe("Notion prospect Sales Navigator note", () => {
  it("appends the Sales Navigator URL as the final line", async () => {
    await expect(createdNote(prospect({ salesNavUrl }))).resolves.toBe(
      `PROSPECT RECORDED, NOT CONTACTED: Accepted an inbound connection request.\nSales Nav: ${salesNavUrl}`
    );
  });

  it("keeps the existing note byte-for-byte when no Sales Navigator URL exists", async () => {
    await expect(createdNote(prospect())).resolves.toBe(
      "PROSPECT RECORDED, NOT CONTACTED: Accepted an inbound connection request."
    );
  });
});
