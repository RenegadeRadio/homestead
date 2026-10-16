import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CrmProspectEntry, Store } from "@/lib/types";

const storeMocks = vi.hoisted(() => ({
  getStore: vi.fn(),
  updateStore: vi.fn(),
}));

vi.mock("@/lib/store", () => storeMocks);

import { syncProspectEntry, syncProspects } from "@/lib/crm/notion-sync";

const sluglessProspect: CrmProspectEntry = {
  id: "prospect_slugless",
  at: "2026-09-20T10:00:00.000Z",
  botId: "bot_1",
  name: "Ada Lovelace",
  profileUrl: "https://www.linkedin.com/sales/lead/ACwAAA0000000000000000000000000000000000",
  slug: null,
  lane: "B",
  source: "linkedin",
  status: "queued",
  note: "Research only.",
};

describe("slugless Notion CRM prospect sync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports the missing slug and leaves the prospect unsynced", async () => {
    const env = { CREW_NOTION_TOKEN: "secret-notion-token" };

    await expect(
      syncProspectEntry(sluglessProspect, { env, fetchFn: vi.fn() })
    ).resolves.toEqual({ state: "skipped", detail: "no profile slug" });

    const store = { crmProspects: [{ ...sluglessProspect }] } as Store;
    storeMocks.getStore.mockResolvedValue(store);
    storeMocks.updateStore.mockImplementation(async (fn: (value: Store) => unknown) => fn(store));

    await expect(syncProspects({ env, fetchFn: vi.fn() })).resolves.toMatchObject({ skipped: 1 });
    expect(store.crmProspects?.[0].syncedAt).toBeUndefined();
  });
});
