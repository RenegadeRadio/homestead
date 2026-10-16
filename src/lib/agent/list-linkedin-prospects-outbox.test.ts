import { describe, expect, it, vi } from "vitest";

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
import type { CrmProspectEntry, OutboxItem } from "@/lib/types";

function prospect(slug: string): CrmProspectEntry {
  return {
    id: `prospect_${slug}`,
    at: "2026-10-01T10:00:00.000Z",
    botId: "bot_1",
    name: slug,
    profileUrl: `https://www.linkedin.com/in/${slug}/`,
    slug,
    lane: "B",
    source: "linkedin",
    status: "accepted",
    note: `note for ${slug}`,
  };
}

function outboxItem(
  id: string,
  slug: string,
  status: OutboxItem["status"],
  options: Pick<OutboxItem, "kind" | "error"> = {}
): OutboxItem {
  return {
    id,
    name: slug,
    profileUrl: `https://www.linkedin.com/in/${slug}/`,
    text: "Good to meet you",
    status,
    kind: options.kind,
    error: options.error,
    createdAt: "2026-10-02T10:00:00.000Z",
    createdBy: "operator",
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

async function listProspect(store: ReturnType<typeof createSeedStore>, slug: string) {
  return executeTool("list_linkedin_prospects", { slugs: [slug] }, context(store));
}

describe("list_linkedin_prospects Outbox follow-up", () => {
  it("shows a rejected follow-up for an accepted prospect", async () => {
    const store = createSeedStore();
    store.crmProspects = [prospect("rejected-person")];
    store.outbox = [outboxItem("outbox_1", "rejected-person", "rejected")];

    const result = await listProspect(store, "rejected-person");

    expect(result.result).toContain("Outbox follow-up: rejected");
  });

  it("shows the error on a failed follow-up", async () => {
    const store = createSeedStore();
    const error = "Already messaged on 2026-10-01: Good to meet you";
    store.crmProspects = [prospect("failed-person")];
    store.outbox = [outboxItem("outbox_1", "failed-person", "failed", { error })];

    const result = await listProspect(store, "failed-person");

    expect(result.result).toContain(`Outbox follow-up: failed (${error})`);
  });

  it("ignores invite items", async () => {
    const store = createSeedStore();
    store.crmProspects = [prospect("invited-person")];
    store.outbox = [outboxItem("outbox_1", "invited-person", "sent", { kind: "invite" })];

    const result = await listProspect(store, "invited-person");

    expect(result.result).toContain("Outbox follow-up: none");
  });

  it("shows the last follow-up in the Outbox array", async () => {
    const store = createSeedStore();
    store.crmProspects = [prospect("redrafted-person")];
    store.outbox = [
      outboxItem("outbox_1", "redrafted-person", "rejected"),
      outboxItem("outbox_2", "redrafted-person", "draft"),
    ];

    const result = await listProspect(store, "redrafted-person");

    expect(result.result).toContain("Outbox follow-up: draft");
    expect(result.result).not.toContain("Outbox follow-up: rejected");
  });
});
