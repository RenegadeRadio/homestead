import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserSnapshot: vi.fn(),
    browserPress: vi.fn(),
    browserType: vi.fn(),
  };
});

import { browserPress, browserSnapshot, browserType } from "@/lib/browser";
import { executeApprovedAction, type ToolContext } from "@/lib/agent/execute";
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

function approval(
  ctx: ToolContext,
  toolName: string,
  args: Record<string, unknown>
): PendingApproval {
  return {
    id: "appr_blocked",
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    botId: ctx.bot.id,
    toolName,
    args,
    createdAt: new Date(0).toISOString(),
    checkpoint: [],
    kind: "send",
    title: "Approve browser action?",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(browserSnapshot).mockResolvedValue({
    url: "https://www.linkedin.com/messaging/thread/abc/",
    title: "LinkedIn",
    snapshot: "",
    gate: { needed: false, reason: "" },
  });
});

describe("blocked approved LinkedIn actions", () => {
  it("does not record a blocked Enter press", async () => {
    const ctx = context();
    vi.mocked(browserPress).mockResolvedValue({ blocked: true, result: blockedText });

    const result = await executeApprovedAction(
      approval(ctx, "browser_press", { key: "Enter" }),
      ctx.bot,
      ctx.store
    );

    expect(result).toBe(blockedText);
    expect(ctx.store.settings.linkedinLastActionAt).toBeUndefined();
    expect(ctx.store.linkedinSendLog).toBeUndefined();
  });

  it("does not record blocked typing", async () => {
    const ctx = context();
    vi.mocked(browserType).mockResolvedValue({ blocked: true, result: blockedText });

    const result = await executeApprovedAction(
      approval(ctx, "browser_type", { text: "hello" }),
      ctx.bot,
      ctx.store
    );

    expect(result).toBe(blockedText);
    expect(ctx.store.settings.linkedinLastActionAt).toBeUndefined();
    expect(ctx.store.linkedinSendLog).toBeUndefined();
  });
});
