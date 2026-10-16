import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserClick: vi.fn(),
    browserNavigate: vi.fn(),
    browserPress: vi.fn(),
    browserScroll: vi.fn(),
    browserSnapshot: vi.fn(),
    browserType: vi.fn(),
    setBrowserMode: vi.fn(),
  };
});

import { executeTool } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";
import type { CrmProspectEntry } from "@/lib/types";

function prospect(
  slug: string,
  at: string,
  overrides: Partial<CrmProspectEntry> = {}
): CrmProspectEntry {
  return {
    id: `prospect_${slug}`,
    at,
    botId: "bot_1",
    name: slug,
    profileUrl: `https://www.linkedin.com/in/${slug}/`,
    slug,
    lane: "B",
    source: "linkedin",
    status: "queued",
    note: `  note for ${slug}\nsecond line  `,
    ...overrides,
  };
}

function context(store: ReturnType<typeof createSeedStore>) {
  return {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CREW_NOTION_TOKEN;
});

describe("LinkedIn prospect workflow tools", () => {
  it("filters and lists matching prospects newest first with notes unchanged", async () => {
    const store = createSeedStore();
    store.crmProspects = [
      prospect("older", "2026-09-20T10:00:00.000Z"),
      prospect("wrong-lane", "2026-09-22T10:00:00.000Z", { lane: "A" }),
      prospect("wrong-status", "2026-09-23T10:00:00.000Z", { status: "pending" }),
      prospect("newer", "2026-09-21T10:00:00.000Z"),
    ];

    const result = await executeTool(
      "list_linkedin_prospects",
      { lane: "B", status: "queued" },
      context(store)
    );

    expect(result.result.indexOf("newer")).toBeLessThan(result.result.indexOf("older"));
    expect(result.result).not.toContain("wrong-lane");
    expect(result.result).not.toContain("wrong-status");
    expect(result.result).toContain("Note:   note for newer\nsecond line  ");
  });

  it("caps list results at 200", async () => {
    const store = createSeedStore();
    store.crmProspects = Array.from({ length: 209 }, (_, index) =>
      prospect(`person-${index}`, new Date(index * 1000).toISOString())
    );

    const result = await executeTool(
      "list_linkedin_prospects",
      { limit: 500 },
      context(store)
    );

    expect(result.result.match(/^Profile:/gm)).toHaveLength(200);
  });

  it("records known acceptances locally and in Notion and reports unknown slugs", async () => {
    const store = createSeedStore();
    store.crmProspects = [prospect("known", "2026-09-23T10:00:00.000Z")];
    process.env.CREW_NOTION_TOKEN = "secret";
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                id: "page_1",
                properties: {
                  Status: { select: { name: "pending" } },
                  LinkedIn: { url: "https://www.linkedin.com/in/known/" },
                },
              },
            ],
            has_more: false,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);

    const result = await executeTool(
      "record_linkedin_acceptances",
      { slugs: ["known", "unknown"] },
      context(store)
    );

    expect(store.crmProspects[0].status).toBe("accepted");
    expect(result.result).toContain("known: updated locally, updated in Notion");
    expect(result.result).toContain("unknown: not found");
    const update = JSON.parse(String(fetchFn.mock.calls[1][1]?.body));
    expect(update.properties.Status.select.name).toBe("accepted");
  });
});
