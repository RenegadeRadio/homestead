import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserClick: vi.fn(),
    browserComposeText: vi.fn(),
    browserLook: vi.fn(),
    browserNavigate: vi.fn(),
    browserPress: vi.fn(),
    browserScroll: vi.fn(),
    browserSnapshot: vi.fn(),
    browserType: vi.fn(),
    setBrowserMode: vi.fn(),
  };
});

import * as browser from "@/lib/browser";
import { executeTool } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";

function prospect(name: string, slug: string) {
  return {
    name,
    profileUrl: `https://www.linkedin.com/in/${slug}/`,
    lane: "B",
    source: "linkedin",
    status: "queued",
    note: "Research only.",
    salesNavUrl: `https://www.linkedin.com/sales/lead/${slug}`,
  };
}

async function record(prospects: unknown[]) {
  const store = createSeedStore();
  const result = await executeTool(
    "record_linkedin_prospects",
    { prospects },
    {
      store,
      bot: store.bots[0],
      conversationId: store.conversations[0].id,
      messageId: store.messages[0].id,
    }
  );
  return { result, store };
}

describe("record_linkedin_prospects", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records three prospects without approval or a browser call", async () => {
    const { result, store } = await record([
      prospect("Ada Lovelace", "ada-lovelace"),
      prospect("Grace Hopper", "grace-hopper"),
      prospect("Katherine Johnson", "katherine-johnson"),
    ]);

    expect(result.result).toContain("Recorded 3");
    expect(result.approval).toBeUndefined();
    expect(store.crmProspects).toHaveLength(3);
    expect(store.pendingApprovals).toHaveLength(0);
    expect(store.computerLogs[0].summary).toBe("Recorded 3 prospects, refused 0");
    for (const fn of [
      browser.browserClick,
      browser.browserComposeText,
      browser.browserLook,
      browser.browserNavigate,
      browser.browserPress,
      browser.browserScroll,
      browser.browserSnapshot,
      browser.browserType,
      browser.setBrowserMode,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("records good items when another item has an invalid lane", async () => {
    const invalid = prospect("Grace Hopper", "grace-hopper");
    invalid.lane = "Lane B";
    const { result, store } = await record([
      prospect("Ada Lovelace", "ada-lovelace"),
      invalid,
      prospect("Katherine Johnson", "katherine-johnson"),
    ]);

    expect(store.crmProspects?.map((entry) => entry.name)).toEqual([
      "Ada Lovelace",
      "Katherine Johnson",
    ]);
    expect(result.result).toContain("Grace Hopper");
    expect(result.result).toContain('Refused: lane must be "A" or "B".');
  });

  it("records the first item and refuses a duplicate profile slug", async () => {
    const first = prospect("Ada Lovelace", "ada-lovelace");
    const duplicate = {
      ...prospect("Ada Duplicate", "ada-lovelace"),
      profileUrl: "https://www.linkedin.com/in/ada-lovelace/?trk=public_profile",
    };
    const { result, store } = await record([first, duplicate]);

    expect(store.crmProspects).toHaveLength(1);
    expect(store.crmProspects?.[0].name).toBe("Ada Lovelace");
    expect(result.result).toContain("Ada Duplicate");
    expect(result.result).toContain("duplicate of Ada Lovelace");
  });

  it("keeps the salesNavUrl on the stored entry", async () => {
    const item = prospect("Ada Lovelace", "ACwAAAExample");
    const { store } = await record([item]);

    expect(store.crmProspects).toHaveLength(1);
    expect(store.crmProspects?.[0].salesNavUrl).toBe(
      "https://www.linkedin.com/sales/lead/ACwAAAExample"
    );
  });
});
