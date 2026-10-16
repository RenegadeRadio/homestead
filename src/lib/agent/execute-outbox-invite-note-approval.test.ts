import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return { ...actual, browserSnapshot: vi.fn(), browserType: vi.fn() };
});

import { executeTool, type ToolContext } from "@/lib/agent/execute";
import { browserSnapshot, browserType } from "@/lib/browser";
import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { createSeedStore } from "@/lib/seed";

describe("executeTool invite note approval", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks when typing an approved invite note without a newline", async () => {
    const store = createSeedStore();
    const item = createOutboxItem(store, {
      name: "Ada Lovelace",
      profileUrl: "https://www.linkedin.com/in/ada-lovelace",
      text: "I enjoyed your work.",
      kind: "invite",
      createdBy: "operator",
    });
    approveOutboxItems(store, { ids: [item.id] });
    item.status = "sending";
    vi.mocked(browserSnapshot).mockResolvedValue({
      url: item.profileUrl,
      title: "LinkedIn",
      snapshot: "Add a note",
      gate: { needed: false, reason: "" },
    });
    const ctx: ToolContext = {
      store,
      bot: store.bots[0],
      conversationId: store.conversations[0].id,
      messageId: store.messages[0].id,
    };

    const outcome = await executeTool("browser_type", { text: item.text }, ctx);

    expect(outcome.approval?.kind).toBe("send");
    expect(outcome.result).toContain("Send to Ada Lovelace?");
    expect(browserType).not.toHaveBeenCalled();
  });
});
