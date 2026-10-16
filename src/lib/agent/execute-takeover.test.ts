import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserNavigate: vi.fn(),
    browserSnapshot: vi.fn(),
    browserClick: vi.fn(),
  };
});

import { browserClick, browserNavigate, browserSnapshot } from "@/lib/browser";
import { executeApprovedAction, executeTool, type ToolContext } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";
import type { PendingApproval } from "@/lib/types";

const blockedText = "The user has the computer. Wait until they continue.";

function context(): ToolContext {
  const store = createSeedStore();
  store.settings.linkedinActionGapMinSeconds = 0;
  store.settings.linkedinActionGapMaxSeconds = 0;
  store.settings.linkedinSendWindowEnd = store.settings.linkedinSendWindowStart = "09:00";
  return {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
  };
}

function approval(ctx: ToolContext): PendingApproval {
  return {
    id: "appr_test",
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    botId: ctx.bot.id,
    toolName: "browser_click",
    args: { ref: 3, label: '[3] button "Send"' },
    createdAt: new Date(0).toISOString(),
    checkpoint: [],
    kind: "send",
    title: "Approve browser action?",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("blocked browser action callers", () => {
  it("does not record or log a blocked LinkedIn navigation", async () => {
    const ctx = context();
    const initialLogs = ctx.store.computerLogs.length;
    vi.mocked(browserNavigate).mockResolvedValue({ blocked: true, result: blockedText });

    const result = await executeTool(
      "browser_navigate",
      { url: "https://www.linkedin.com/search/results/people/?keywords=x" },
      ctx
    );

    expect(result.result).toBe(blockedText);
    expect(ctx.store.settings.linkedinLastActionAt).toBeUndefined();
    expect(ctx.store.computerLogs).toHaveLength(initialLogs);
  });

  it("does not record a blocked approved LinkedIn click", async () => {
    const ctx = context();
    const initialLogs = ctx.store.computerLogs.length;
    vi.mocked(browserSnapshot).mockResolvedValue({
      url: "https://www.linkedin.com/messaging/",
      title: "LinkedIn",
      snapshot: '[3] button "Send"',
      gate: { needed: false, reason: "" },
    });
    vi.mocked(browserClick).mockResolvedValue({ blocked: true, result: blockedText });

    const result = await executeApprovedAction(approval(ctx), ctx.bot, ctx.store);

    expect(result).toBe(blockedText);
    expect(ctx.store.settings.linkedinLastActionAt).toBeUndefined();
    expect(ctx.store.linkedinSendLog).toBeUndefined();
    expect(ctx.store.computerLogs).toHaveLength(initialLogs);
  });
});
