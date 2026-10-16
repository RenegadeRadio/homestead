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
import type { CrmProspectEntry, Store } from "@/lib/types";

function context(store: Store) {
  return {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
  };
}

function acceptedProspect(slug: string): CrmProspectEntry {
  return {
    id: `prospect_${slug}`,
    at: "2026-10-01T00:00:00.000Z",
    botId: "bot_1",
    name: slug,
    profileUrl: `https://www.linkedin.com/in/${slug}/`,
    slug,
    lane: "A",
    source: "linkedin",
    status: "pending",
    note: "test",
  };
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CREW_NOTION_TOKEN;
});

describe("invite note report tool", () => {
  it("keeps the first-seen acceptance time when recording a slug twice", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-10-10T10:00:00.000Z");
    const store = createSeedStore();
    store.crmProspects = [acceptedProspect("person")];

    await executeTool("record_linkedin_acceptances", { slugs: ["person"] }, context(store));
    vi.setSystemTime("2026-10-11T10:00:00.000Z");
    await executeTool("record_linkedin_acceptances", { slugs: ["person"] }, context(store));

    expect(store.crmProspects[0].acceptedAt).toBe("2026-10-10T10:00:00.000Z");
    expect(store.crmProspects[0].acceptedAtSource).toBe("first-seen");
  });

  it("returns the report through executeTool", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-10-10T10:00:00.000Z");
    const store = createSeedStore();
    store.outbox = [
      {
        id: "outbox_1",
        name: "Person",
        profileUrl: "https://www.linkedin.com/in/person/",
        text: "Try one free app",
        status: "sent",
        kind: "invite",
        lane: "A",
        sentAt: "2026-10-09T10:00:00.000Z",
        createdAt: "2026-10-09T10:00:00.000Z",
        createdBy: "operator",
      },
    ];

    const outcome = await executeTool("invite_note_report", {}, context(store));

    expect(outcome.result).toContain("sent 1");
    expect(outcome.result).toMatch(
      /Acceptance dates are when Homestead first saw the acceptance, not when it happened\.$/
    );
  });
});
