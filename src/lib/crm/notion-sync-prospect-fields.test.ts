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
    at: "2026-10-05T10:00:00.000Z",
    botId: "bot_1",
    name: "Ada Lovelace",
    profileUrl: "https://www.linkedin.com/in/ada-lovelace/",
    slug: "ada-lovelace",
    lane: "A",
    source: "linkedin",
    status: "queued",
    note: "Research only.",
    ...overrides,
  };
}

async function createdProperties(entry: CrmProspectEntry) {
  const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input) === "https://api.notion.com/v1/pages" && init?.method === "POST") {
      return { ok: true, status: 200, json: async () => ({ id: "created_1" }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
  await syncProspectEntry(entry, {
    fetchFn,
    env: { CREW_NOTION_TOKEN: "secret-notion-token" },
    rows: [],
  });
  const call = fetchFn.mock.calls.find(
    ([input, init]) =>
      String(input) === "https://api.notion.com/v1/pages" && init?.method === "POST"
  );
  return JSON.parse(String(call?.[1]?.body)).properties as Record<string, unknown>;
}

describe("Notion prospect structured fields", () => {
  it("writes company, title, headcount and industry properties", async () => {
    const properties = await createdProperties(
      prospect({
        company: "Analytical Engines Ltd",
        role: "Founder",
        headcount: "11-50",
        industry: "Software",
      })
    );

    expect(properties.Company).toEqual({
      rich_text: [{ type: "text", text: { content: "Analytical Engines Ltd" } }],
    });
    expect(properties.Title).toEqual({
      rich_text: [{ type: "text", text: { content: "Founder" } }],
    });
    expect(properties.Headcount).toEqual({ select: { name: "11-50" } });
    expect(properties.Industry).toEqual({
      rich_text: [{ type: "text", text: { content: "Software" } }],
    });
  });

  it("omits structured properties when the prospect has none", async () => {
    const properties = await createdProperties(prospect());

    expect(properties).not.toHaveProperty("Company");
    expect(properties).not.toHaveProperty("Title");
    expect(properties).not.toHaveProperty("Headcount");
    expect(properties).not.toHaveProperty("Industry");
  });
});
