import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserSnapshot: vi.fn(),
    browserClick: vi.fn(),
    browserPageText: vi.fn().mockResolvedValue(""),
  };
});

import { browserClick, browserSnapshot } from "@/lib/browser";
import { executeApprovedAction, type ToolContext } from "@/lib/agent/execute";
import { linkedInBudgetIO } from "@/lib/agent/linkedin-budget";
import { createOutboxItem } from "@/lib/outbox";
import { createSeedStore } from "@/lib/seed";
import type { PendingApproval } from "@/lib/types";

const profileUrl = "https://www.linkedin.com/in/ada-lovelace";

function approval(ctx: ToolContext, ref: number, label: string): PendingApproval {
  return {
    id: `approval-${ref}`,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    botId: ctx.bot.id,
    toolName: "browser_click",
    args: { ref, label },
    createdAt: new Date().toISOString(),
    checkpoint: [],
    kind: "send",
    title: "Approve browser action?",
  };
}

describe("approved LinkedIn invite confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-18T10:00:00.000Z");
    vi.spyOn(linkedInBudgetIO, "sleep").mockResolvedValue();
  });

  afterEach(() => vi.useRealTimers());

  it("allows Send 30 seconds after Connect and completes the sending invite", async () => {
    const store = createSeedStore();
    store.settings.linkedinActionGapMinSeconds = 0;
    store.settings.linkedinActionGapMaxSeconds = 0;
    store.settings.linkedinSendWindowEnd = store.settings.linkedinSendWindowStart = "09:00";
    const ctx: ToolContext = {
      store,
      bot: store.bots[0],
      conversationId: store.conversations[0].id,
      messageId: store.messages[0].id,
    };
    const item = createOutboxItem(store, {
      name: "Ada Lovelace",
      profileUrl,
      text: "Hello Ada",
      kind: "invite",
      lane: "B",
      createdBy: "operator",
    });
    item.status = "sending";

    vi.mocked(browserSnapshot).mockResolvedValue({
      url: profileUrl,
      title: "Ada Lovelace | LinkedIn",
      snapshot: '[3] button "Connect"',
      gate: { needed: false, reason: "" },
    });
    vi.mocked(browserClick).mockResolvedValue({
      url: profileUrl,
      title: "Ada Lovelace | LinkedIn",
      snapshot: "",
      gate: { needed: false, reason: "" },
      blocked: false,
      result: "Clicked Connect.",
      label: "Connect",
    });

    await executeApprovedAction(approval(ctx, 3, '[3] button "Connect"'), ctx.bot, store);
    expect(item.status).toBe("sending");

    vi.setSystemTime("2026-09-18T10:00:30.000Z");
    vi.mocked(browserSnapshot).mockResolvedValue({
      url: profileUrl,
      title: "Ada Lovelace | LinkedIn",
      snapshot: '[5] button "Send invitation"',
      gate: { needed: false, reason: "" },
    });
    vi.mocked(browserClick).mockResolvedValue({
      url: profileUrl,
      title: "Ada Lovelace | LinkedIn",
      snapshot: "",
      gate: { needed: false, reason: "" },
      blocked: false,
      result: "Clicked Send invitation.",
      label: "Send invitation",
    });

    const result = await executeApprovedAction(
      approval(ctx, 5, '[5] button "Send invitation"'),
      ctx.bot,
      store
    );

    expect(result).not.toContain("LinkedIn pacing:");
    expect(store.linkedinSendLog).toHaveLength(1);
    expect(store.linkedinSendLog?.map((entry) => entry.kind)).toEqual(["invite"]);
    expect(item.status).toBe("sent");
    expect(store.linkedinSendLog?.[0]).toMatchObject({ outboxItemId: item.id, lane: "B" });
  });
});
