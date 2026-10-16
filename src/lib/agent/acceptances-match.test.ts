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
import { reconcileInviteProspects } from "@/lib/agent/linkedin-send-log";
import { confirmOutboxItemSent } from "@/lib/outbox";
import { createSeedStore } from "@/lib/seed";
import type { CrmProspectEntry, OutboxItem } from "@/lib/types";

function prospect(slug: string, status: CrmProspectEntry["status"]): CrmProspectEntry {
  return {
    id: `prospect_${slug}`,
    at: "2026-09-20T10:00:00.000Z",
    botId: "bot_1",
    name: slug,
    profileUrl: `https://www.linkedin.com/in/${slug}/`,
    slug,
    lane: "B",
    source: "linkedin",
    status,
    note: `note for ${slug}`,
  };
}

function invite(
  id: string,
  slug: string,
  status: OutboxItem["status"] = "sent"
): OutboxItem {
  return {
    id,
    name: slug,
    profileUrl: `https://www.linkedin.com/in/${slug}/`,
    text: "Hello",
    status,
    kind: "invite",
    lane: "B",
    sentAt: status === "sent" ? "2026-09-25T10:00:00.000Z" : undefined,
    createdAt: "2026-09-20T10:00:00.000Z",
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

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CREW_NOTION_TOKEN;
});

describe("LinkedIn acceptance matching", () => {
  it("creates the missing prospect before recording an acceptance", async () => {
    const store = createSeedStore();
    store.crmProspects = [];
    store.outbox = [invite("outbox_1", "new-person")];
    vi.stubGlobal("fetch", vi.fn());

    const result = await executeTool(
      "record_linkedin_acceptances",
      { slugs: ["new-person"] },
      context(store)
    );

    expect(store.crmProspects).toHaveLength(1);
    expect(store.crmProspects[0]).toMatchObject({
      slug: "new-person",
      lane: "B",
      status: "accepted",
    });
    expect(result.result).toContain("new-person: updated locally");
    expect(result.result).toContain("(lane B)");
  });

  it("moves queued prospects to pending on confirmation without moving messaged prospects", () => {
    const store = createSeedStore();
    store.crmProspects = [prospect("queued", "queued"), prospect("messaged", "messaged")];
    store.outbox = [
      invite("outbox_queued", "queued", "sending"),
      invite("outbox_messaged", "messaged", "sending"),
    ];

    confirmOutboxItemSent(store, { id: "outbox_queued", evidence: "Pending shown" });
    confirmOutboxItemSent(store, { id: "outbox_messaged", evidence: "Pending shown" });

    expect(store.crmProspects.map(({ slug, status }) => ({ slug, status }))).toEqual([
      { slug: "queued", status: "pending" },
      { slug: "messaged", status: "messaged" },
    ]);
  });

  it("reconciles only sent invites and is idempotent", () => {
    const store = createSeedStore();
    store.crmProspects = [prospect("queued", "queued")];
    store.outbox = [
      invite("outbox_missing", "missing"),
      invite("outbox_queued", "queued"),
      invite("outbox_approved", "approved", "approved"),
      invite("outbox_failed", "failed", "failed"),
    ];

    expect(reconcileInviteProspects(store)).toEqual({ created: 1, moved: 1 });
    expect(store.crmProspects.map(({ slug, status }) => ({ slug, status }))).toEqual([
      { slug: "queued", status: "pending" },
      { slug: "missing", status: "pending" },
    ]);
    const reconciled = JSON.stringify(store.crmProspects);
    expect(reconcileInviteProspects(store)).toEqual({ created: 0, moved: 0 });
    expect(JSON.stringify(store.crmProspects)).toBe(reconciled);
  });

  it("lists requested slugs exactly, reports missing slugs, and refuses over 50", async () => {
    const store = createSeedStore();
    store.crmProspects = [
      prospect("first", "queued"),
      prospect("second", "pending"),
      prospect("extra", "queued"),
    ];

    const result = await executeTool(
      "list_linkedin_prospects",
      { slugs: [" FIRST ", "second", "missing"], limit: 1 },
      context(store)
    );
    expect(result.result).toContain("Slug: first");
    expect(result.result).toContain("Slug: second");
    expect(result.result).not.toContain("Slug: extra");
    expect(result.result).toContain("missing: not found");

    const refused = await executeTool(
      "list_linkedin_prospects",
      { slugs: Array.from({ length: 51 }, (_, index) => `person-${index}`) },
      context(store)
    );
    expect(refused.result).toMatch(/^Refused:/);
  });
});
