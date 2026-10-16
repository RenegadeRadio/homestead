import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserSnapshot: vi.fn(),
    browserClick: vi.fn(),
    browserType: vi.fn(),
  };
});

import { browserClick, browserSnapshot, browserType } from "@/lib/browser";
import { executeApprovedAction, type ToolContext } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";
import type { PendingApproval } from "@/lib/types";

function snapshot(url: string, line: string) {
  return {
    url,
    title: "LinkedIn",
    snapshot: line,
    gate: { needed: false, reason: "" },
  };
}

function context(profileUrl: string): ToolContext {
  const store = createSeedStore();
  store.settings.linkedinActionGapMinSeconds = 0;
  store.settings.linkedinActionGapMaxSeconds = 0;
  store.settings.linkedinSendWindowEnd = store.settings.linkedinSendWindowStart = "09:00";
  (store.outbox ??= []).push({
    id: "outbox_jane",
    name: "Jane Doe",
    profileUrl,
    text: "Hello Jane\n",
    status: "sending",
    createdAt: "2026-09-16T09:00:00.000Z",
    createdBy: store.bots[0].id,
  });
  return {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
  };
}

function approval(ctx: ToolContext, toolName: string, args: Record<string, unknown>) {
  return {
    id: `appr_${toolName}`,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    botId: ctx.bot.id,
    toolName,
    args,
    createdAt: new Date().toISOString(),
    checkpoint: [],
    kind: "send",
    title: "Approve browser action?",
  } satisfies PendingApproval;
}

describe("approved LinkedIn typing and Outbox sends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-16T10:00:00.000Z");
  });

  afterEach(() => vi.useRealTimers());

  it("does not record a send or update the Outbox when typing", async () => {
    const profileUrl = "https://www.linkedin.com/in/jane-doe-type-only/";
    const ctx = context(profileUrl);
    ctx.store.settings.linkedinLastActionAt = "2026-09-16T09:55:00.000Z";
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(profileUrl, "Message box"));
    vi.mocked(browserType).mockResolvedValue({
      ...snapshot(profileUrl, ""),
      result: "Typed.",
    });

    await executeApprovedAction(
      approval(ctx, "browser_type", { text: "Hello Jane\n" }),
      ctx.bot,
      ctx.store
    );

    expect(ctx.store.outbox?.[0].status).toBe("sending");
    expect(ctx.store.linkedinSendLog ?? []).toHaveLength(0);
    expect(ctx.store.settings.linkedinLastActionAt).toBe("2026-09-16T09:55:00.000Z");
  });

  it("records one send and marks the Outbox item sent only after the Send click", async () => {
    const profileUrl = "https://www.linkedin.com/in/jane-doe-type-then-click/";
    const ctx = context(profileUrl);
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(profileUrl, "Message box"));
    vi.mocked(browserType).mockResolvedValue({
      ...snapshot(profileUrl, ""),
      result: "Typed.",
    });

    await executeApprovedAction(
      approval(ctx, "browser_type", { text: "Hello Jane\n" }),
      ctx.bot,
      ctx.store
    );
    expect(ctx.store.outbox?.[0].status).toBe("sending");

    vi.advanceTimersByTime(30_000);
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(profileUrl, '[3] button "Send"'));
    vi.mocked(browserClick).mockResolvedValue({
      ...snapshot(profileUrl, ""),
      blocked: false,
      result: "Clicked Send.",
      label: "Send",
    });

    const result = await executeApprovedAction(
      approval(ctx, "browser_click", { ref: 3, label: '[3] button "Send"' }),
      ctx.bot,
      ctx.store
    );

    expect(result).toBe("Clicked Send.");
    expect(browserClick).toHaveBeenCalledOnce();
    expect(ctx.store.linkedinSendLog).toHaveLength(1);
    expect(ctx.store.linkedinSendLog?.[0]).toMatchObject({
      kind: "message",
      action: "click",
      text: "Hello Jane\n",
    });
    expect(ctx.store.outbox?.[0].status).toBe("sent");
    expect(ctx.store.outbox?.[0].sentAt).toBe(ctx.store.linkedinSendLog?.[0].at);
  });
});
