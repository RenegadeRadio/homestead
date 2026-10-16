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

describe("queue_linkedin_message", () => {
  it("queues a draft for approval without an approval or browser call", async () => {
    const store = createSeedStore();
    const bot = store.bots[0];
    const approvalsBefore = store.pendingApprovals.length;

    const result = await executeTool(
      "queue_linkedin_message",
      {
        name: "Ada",
        profileUrl: "https://www.linkedin.com/in/ada",
        text: "Hello Ada",
      },
      {
        store,
        bot,
        conversationId: store.conversations[0].id,
        messageId: store.messages[0].id,
      }
    );

    expect(result).toEqual({ result: "Queued for approval: Ada" });
    expect(store.outbox).toHaveLength(1);
    expect(store.outbox?.[0]).toMatchObject({ status: "draft", createdBy: bot.id });
    expect(store.pendingApprovals).toHaveLength(approvalsBefore);
    expect(vi.mocked(browser.browserNavigate)).not.toHaveBeenCalled();
    expect(vi.mocked(browser.browserClick)).not.toHaveBeenCalled();
    expect(vi.mocked(browser.browserType)).not.toHaveBeenCalled();
  });
});
