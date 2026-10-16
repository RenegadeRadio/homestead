import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LinkedInSendEntry } from "@/lib/types";

const storeMocks = vi.hoisted(() => ({
  getStore: vi.fn(),
  updateStore: vi.fn(),
}));

vi.mock("@/lib/store", () => storeMocks);

import { syncSendEntry } from "@/lib/crm/notion-sync";

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

function successfulFetch(status: string) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response({
        results: [
          {
            id: "page_1",
            properties: {
              Status: { select: { name: status } },
              LinkedIn: { url: "https://linkedin.com/in/example-person" },
            },
          },
        ],
        has_more: false,
      })
    )
    .mockResolvedValueOnce(response({ results: [], has_more: false }))
    .mockResolvedValue(response({}));
}

describe("Notion CRM sends with unknown text", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records an unknown message text in Latest note", async () => {
    const fetchFn = successfulFetch("accepted");
    await syncSendEntry(
      entry({ kind: "message", text: null, at: "2026-10-01T09:00:00.000Z" }),
      { fetchFn, env: { CREW_NOTION_TOKEN: token } }
    );

    const update = JSON.parse(String(fetchFn.mock.calls[2][1]?.body));
    expect(update.properties.Status.select.name).toBe("messaged");
    expect(update.properties["Latest note"].rich_text[0].text.content).toBe(
      "Message sent 2026-10-01; Homestead recorded no text."
    );
  });

  it("replaces a held invite draft with an unknown text note", async () => {
    const fetchFn = successfulFetch("held");
    await syncSendEntry(entry({ kind: "invite", text: null }), {
      fetchFn,
      env: { CREW_NOTION_TOKEN: token },
    });

    const update = JSON.parse(String(fetchFn.mock.calls[2][1]?.body));
    const content = update.properties["Latest note"].rich_text[0].text.content;
    expect(content.startsWith("Invite sent ")).toBe(true);
    expect(content.endsWith("; Homestead recorded no text.")).toBe(true);
    expect(content).not.toContain("DRAFT");
  });
});
