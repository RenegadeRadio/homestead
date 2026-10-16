import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserSnapshot: vi.fn(),
    browserClick: vi.fn(),
    looksLikeSend: actual.looksLikeSend,
  };
});

import { browserClick, browserSnapshot } from "@/lib/browser";
import { executeApprovedAction, executeTool, type ToolContext } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";

const label = '[3] link "Send a message to Blaise Pascal"';
const snapshot = (line: string) => ({
  url: "https://www.linkedin.com/in/blaise-pascal/",
  title: "LinkedIn",
  snapshot: line,
  gate: { needed: false, reason: "" },
});

function context(): ToolContext {
  const store = createSeedStore();
  return {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
  };
}

describe("LinkedIn send pacing gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-16T10:00:10.000Z");
  });

  afterEach(() => vi.useRealTimers());

  it("does not pace a click that only opens the message box", async () => {
    const ctx = context();
    ctx.store.settings.linkedinLastActionAt = "2026-09-16T10:00:00.000Z";
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(label));

    const result = await executeTool("browser_click", { ref: 3 }, ctx);

    expect(result.approval).toBeUndefined();
    expect(result.result).not.toMatch(/^LinkedIn pacing:/);
  });

  it("runs an approved message-box click without recording a send or changing the clock", async () => {
    const ctx = context();
    const lastActionAt = "2026-09-16T10:00:00.000Z";
    ctx.store.settings.linkedinLastActionAt = lastActionAt;
    const sendLogBefore = ctx.store.linkedinSendLog?.length ?? 0;
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(label));
    vi.mocked(browserClick).mockResolvedValue({
      ...snapshot("Message box"),
      blocked: false,
      result: "Opened message box.",
      label: "Send a message to Blaise Pascal",
    });

    await executeApprovedAction(
      {
        id: "appr_test",
        conversationId: ctx.conversationId,
        messageId: ctx.messageId,
        botId: ctx.bot.id,
        toolName: "browser_click",
        args: { ref: 3, label },
        createdAt: new Date().toISOString(),
        checkpoint: [],
        kind: "send",
        title: "Approve browser click?",
      },
      ctx.bot,
      ctx.store
    );

    expect(ctx.store.linkedinSendLog?.length ?? 0).toBe(sendLogBefore);
    expect(ctx.store.settings.linkedinLastActionAt).toBe(lastActionAt);
    expect(ctx.store.computerLogs[0]?.summary).toBe("Approved browser click");
  });

  it("paces a real Send click", async () => {
    const ctx = context();
    ctx.store.settings.linkedinLastActionAt = "2026-09-16T10:00:00.000Z";
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot('[3] button "Send"'));

    const result = await executeTool("browser_click", { ref: 3 }, ctx);

    expect(result.result).toMatch(/^Refused:/);
    expect(result.approval).toBeUndefined();
  });

  it("uses the forty-five-minute default gap", async () => {
    vi.setSystemTime("2026-09-16T10:46:00.000Z");
    const ctx = context();
    ctx.store.settings.linkedinLastActionAt = "2026-09-16T10:00:00.000Z";
    ctx.store.settings.linkedinGapSeconds = undefined;
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot('[3] button "Send"'));

    const result = await executeTool("browser_click", { ref: 3 }, ctx);

    expect(result.approval).toBeUndefined();
    expect(result.result).not.toMatch(/^LinkedIn pacing:/);
  });
});
