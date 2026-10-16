import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deferOutboxRun = vi.hoisted(() => vi.fn());

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserSnapshot: vi.fn(),
    browserClick: vi.fn(),
  };
});
vi.mock("@/lib/outbox-bot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/outbox-bot")>();
  return { ...actual, deferOutboxRun };
});

import { executeApprovedAction, executeTool, type ToolContext } from "@/lib/agent/execute";
import { browserClick, browserSnapshot } from "@/lib/browser";
import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { createSeedStore } from "@/lib/seed";

const sendSnapshot = {
  url: "https://www.linkedin.com/in/ada/",
  title: "LinkedIn",
  snapshot: '[3] button "Send"',
  gate: { needed: false, reason: "" },
};

function context() {
  const store = createSeedStore();
  store.settings.linkedinActionGapMinSeconds = 0;
  store.settings.linkedinActionGapMaxSeconds = 0;
  store.settings.linkedinSendWindowEnd = store.settings.linkedinSendWindowStart = "09:00";
  const item = createOutboxItem(store, {
    name: "Ada",
    profileUrl: sendSnapshot.url,
    text: "Hello Ada",
    createdBy: "operator",
  });
  approveOutboxItems(store, { ids: [item.id] });
  item.status = "sending";
  item.sendingAt = "2026-09-21T09:59:00.000Z";
  store.settings.linkedinLastActionAt = "2026-09-21T10:00:00.000Z";
  const ctx: ToolContext = {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
  };
  return { ctx, item };
}

describe("Outbox LinkedIn pacing deferral", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-21T10:00:10.000Z");
    vi.mocked(browserSnapshot).mockResolvedValue(sendSnapshot);
  });

  afterEach(() => vi.useRealTimers());

  it("releases a sending item when a direct send is refused", async () => {
    const { ctx, item } = context();

    const outcome = await executeTool("browser_click", { ref: 3 }, ctx);

    expect(outcome.result).toMatch(/^LinkedIn pacing:/);
    expect(item).toMatchObject({ status: "approved" });
    expect(item.sendingAt).toBeUndefined();
    expect(item.status).not.toBe("failed");
    expect(item.status).not.toBe("sent");
    expect(deferOutboxRun).toHaveBeenCalledOnce();
    expect(deferOutboxRun).toHaveBeenCalledWith(ctx.store, new Date("2026-09-21T10:45:00.000Z"));
    expect(browserClick).not.toHaveBeenCalled();
  });

  it("releases a sending item when an approved send is refused", async () => {
    const { ctx, item } = context();

    const result = await executeApprovedAction(
      {
        id: "appr_test",
        conversationId: ctx.conversationId,
        messageId: ctx.messageId,
        botId: ctx.bot.id,
        toolName: "browser_click",
        args: { ref: 3, label: '[3] button "Send"' },
        createdAt: new Date().toISOString(),
        checkpoint: [],
        kind: "send",
        title: "Approve browser click?",
      },
      ctx.bot,
      ctx.store
    );

    expect(result).toMatch(/^LinkedIn pacing:/);
    expect(item).toMatchObject({ status: "approved" });
    expect(item.sendingAt).toBeUndefined();
    expect(deferOutboxRun).toHaveBeenCalledWith(ctx.store, new Date("2026-09-21T10:45:00.000Z"));
    expect(browserClick).not.toHaveBeenCalled();
  });
});
