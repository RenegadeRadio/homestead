import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserSnapshot: vi.fn(),
    browserClick: vi.fn(),
    browserType: vi.fn(),
    browserPress: vi.fn(),
  };
});

import {
  browserClick,
  browserPress,
  browserSnapshot,
  browserType,
  formatSnapshot,
  type SnapshotEl,
} from "@/lib/browser";
import { executeApprovedAction, executeTool, type ToolContext } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";
import type { PendingApproval } from "@/lib/types";

const profileUrl = "https://www.linkedin.com/in/jane-doe-123/";

function snapshot(url: string, line: string) {
  return {
    url,
    title: "Page",
    snapshot: line,
    gate: { needed: false, reason: "" },
  };
}

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

function approval(ctx: ToolContext, toolName: string, args: Record<string, unknown>) {
  return {
    id: "appr_linkedin_send_log",
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

describe("LinkedIn send logging through browser execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-16T10:00:00.000Z");
  });

  afterEach(() => vi.useRealTimers());

  it("records a later Send, but not an approved Connect, as an invite", async () => {
    const ctx = context();
    vi.mocked(browserSnapshot).mockResolvedValue(
      snapshot(profileUrl, '[3] button "Connect"')
    );
    vi.mocked(browserClick).mockResolvedValue({
      ...snapshot(profileUrl, ""),
      blocked: false,
      result: "Clicked Connect.",
      label: "Connect",
    });

    await executeApprovedAction(
      approval(ctx, "browser_click", { ref: 3, label: '[3] button "Connect"' }),
      ctx.bot,
      ctx.store
    );

    expect(ctx.store.linkedinSendLog).toBeUndefined();

    vi.setSystemTime("2026-09-16T10:06:00.000Z");
    vi.mocked(browserSnapshot).mockResolvedValue(
      snapshot(profileUrl, '[4] button "Send invitation"')
    );
    vi.mocked(browserClick).mockResolvedValue({
      ...snapshot(profileUrl, ""),
      blocked: false,
      result: "Clicked Send invitation.",
      label: "Send invitation",
    });

    await executeApprovedAction(
      approval(ctx, "browser_click", {
        ref: 4,
        label: '[4] button "Send invitation"',
      }),
      ctx.bot,
      ctx.store
    );

    expect(ctx.store.linkedinSendLog).toHaveLength(1);
    expect(ctx.store.linkedinSendLog?.[0]).toMatchObject({
      slug: "jane-doe-123",
      action: "click",
      kind: "invite",
    });
  });

  it("records accumulated unapproved typing once and clears it after approved Send", async () => {
    const ctx = context();
    vi.mocked(browserType)
      .mockResolvedValueOnce({ ...snapshot(profileUrl, ""), result: "Typed." })
      .mockResolvedValueOnce({ ...snapshot(profileUrl, ""), result: "Typed." });

    await executeTool("browser_type", { text: "Hi Jane, " }, ctx);
    await executeTool("browser_type", { text: "thanks for connecting." }, ctx);

    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(profileUrl, '[3] button "Send"'));
    vi.mocked(browserClick).mockResolvedValue({
      ...snapshot(profileUrl, ""),
      blocked: false,
      result: "Clicked Send.",
      label: "Send",
    });
    const send = approval(ctx, "browser_click", { ref: 3, label: '[3] button "Send"' });

    await executeApprovedAction(send, ctx.bot, ctx.store);
    expect(ctx.store.linkedinSendLog?.[0]).toMatchObject({
      kind: "message",
      text: "Hi Jane, thanks for connecting.",
    });

    vi.setSystemTime("2026-09-16T10:46:00.000Z");
    await executeApprovedAction(send, ctx.bot, ctx.store);
    expect(ctx.store.linkedinSendLog?.[1]).toMatchObject({ kind: "message", text: null });
  });

  it("records approved Enter on a LinkedIn messaging thread as a message", async () => {
    const ctx = context();
    const threadUrl = "https://www.linkedin.com/messaging/thread/abc/";
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(threadUrl, "Message box"));
    vi.mocked(browserPress).mockResolvedValue({
      ...snapshot(threadUrl, ""),
      result: "Pressed Enter.",
    });

    await executeApprovedAction(
      approval(ctx, "browser_press", { key: "Enter" }),
      ctx.bot,
      ctx.store
    );

    expect(ctx.store.linkedinSendLog).toHaveLength(1);
    expect(ctx.store.linkedinSendLog?.[0]).toMatchObject({
      slug: null,
      action: "press",
      key: "Enter",
      kind: "message",
    });
  });

  it("records neither non-LinkedIn clicks nor LinkedIn clicks refused by pacing", async () => {
    const outside = context();
    vi.mocked(browserSnapshot).mockResolvedValue(
      snapshot("https://example.com/profile/jane", '[3] button "Send"')
    );
    vi.mocked(browserClick).mockResolvedValue({
      ...snapshot("https://example.com/profile/jane", ""),
      blocked: false,
      result: "Clicked Send.",
      label: "Send",
    });

    await executeApprovedAction(
      approval(outside, "browser_click", { ref: 3, label: '[3] button "Send"' }),
      outside.bot,
      outside.store
    );
    expect(outside.store.linkedinSendLog).toBeUndefined();

    const refused = context();
    refused.store.settings.linkedinLastActionAt = "2026-09-16T09:59:00.000Z";
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(profileUrl, '[3] button "Send"'));
    const result = await executeApprovedAction(
      approval(refused, "browser_click", { ref: 3, label: '[3] button "Send"' }),
      refused.bot,
      refused.store
    );

    expect(result).toMatch(/^LinkedIn pacing:/);
    expect(refused.store.linkedinSendLog).toBeUndefined();
    expect(browserClick).toHaveBeenCalledTimes(1);
  });

  it("records approved typed text instead of earlier unapproved text", async () => {
    const ctx = context();
    vi.mocked(browserType).mockResolvedValueOnce({
      ...snapshot(profileUrl, ""),
      result: "Typed.",
    });
    await executeTool("browser_type", { text: "earlier words" }, ctx);

    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(profileUrl, ""));
    vi.mocked(browserType).mockResolvedValueOnce({
      ...snapshot(profileUrl, ""),
      result: "Typed.",
    });
    await executeApprovedAction(
      approval(ctx, "browser_type", { text: "Hello Jane\n" }),
      ctx.bot,
      ctx.store
    );

    expect(ctx.store.linkedinSendLog ?? []).toHaveLength(0);
  });

  it("records the snapshot URL for an approved Enter press", async () => {
    const ctx = context();
    const threadUrl = "https://www.linkedin.com/messaging/thread/abc/";
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(threadUrl, "Message box"));
    vi.mocked(browserPress).mockResolvedValue({
      ...snapshot(threadUrl, ""),
      result: "Pressed Enter.",
    });

    await executeApprovedAction(
      approval(ctx, "browser_press", { key: "Enter" }),
      ctx.bot,
      ctx.store
    );

    expect(ctx.store.linkedinSendLog?.[0]?.url).toBe(threadUrl);
  });

  it("does not add a LinkedIn invite computer log for an approved Connect click", async () => {
    const ctx = context();
    const connectEl: SnapshotEl = {
      ref: 3,
      tag: "button",
      role: "button",
      text: "Connect",
      x: 0,
      y: 0,
    };
    const fullSnapshot = formatSnapshot(profileUrl, "Jane | LinkedIn", [connectEl]);
    const label = fullSnapshot.split("\n").find((line) => line.startsWith("[3]"))!;
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(profileUrl, fullSnapshot));
    vi.mocked(browserClick).mockResolvedValue({
      ...snapshot(profileUrl, ""),
      blocked: false,
      result: "Clicked Connect.",
      label: "Connect",
    });

    await executeApprovedAction(
      approval(ctx, "browser_click", { ref: 3, label }),
      ctx.bot,
      ctx.store
    );

    const logEntry = ctx.store.computerLogs.find((entry) =>
      entry.summary.startsWith("LinkedIn ")
    );
    expect(logEntry).toBeUndefined();
  });
});
