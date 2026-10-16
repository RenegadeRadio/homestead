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

import * as browser from "@/lib/browser";
import { executeTool } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";

describe("record_linkedin_prospect", () => {
  it("records a prospect without approval or a browser call", async () => {
    const store = createSeedStore();
    const bot = store.bots[0];
    const approvalsBefore = store.pendingApprovals.length;

    const result = await executeTool(
      "record_linkedin_prospect",
      {
        name: "Ada Lovelace",
        profileUrl: "https://www.linkedin.com/in/ada-lovelace/",
        lane: "B",
        source: "inbound",
        status: "connected",
        note: "Accepted an inbound connection request.",
      },
      {
        store,
        bot,
        conversationId: store.conversations[0].id,
        messageId: store.messages[0].id,
      }
    );

    expect(result).toEqual({ result: "Recorded Ada Lovelace in the CRM (not contacted)." });
    expect(result.approval).toBeUndefined();
    expect(store.crmProspects).toHaveLength(1);
    expect(store.crmProspects?.[0]).toMatchObject({
      botId: bot.id,
      name: "Ada Lovelace",
      profileUrl: "https://www.linkedin.com/in/ada-lovelace/",
      slug: "ada-lovelace",
      lane: "B",
      source: "inbound",
      status: "connected",
      note: "Accepted an inbound connection request.",
    });
    expect(store.pendingApprovals).toHaveLength(approvalsBefore);
    expect(vi.mocked(browser.browserNavigate)).not.toHaveBeenCalled();
    expect(vi.mocked(browser.browserClick)).not.toHaveBeenCalled();
    expect(vi.mocked(browser.browserType)).not.toHaveBeenCalled();
    expect(vi.mocked(browser.browserSnapshot)).not.toHaveBeenCalled();
  });
});
