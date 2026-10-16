import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserSnapshot: vi.fn(),
    browserClick: vi.fn(),
    browserType: vi.fn(),
    browserPress: vi.fn(),
    browserNavigate: vi.fn(),
    browserScroll: vi.fn(),
    setBrowserMode: vi.fn(),
    looksLikeSend: actual.looksLikeSend,
  };
});

import {
  browserClick,
  browserNavigate,
  browserPress,
  browserSnapshot,
  browserType,
} from "@/lib/browser";
import { executeApprovedAction, executeTool, type ToolContext } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";
import type { PendingApproval } from "@/lib/types";

const snapshot = (line: string) => ({
  url: "https://www.linkedin.com/messaging/",
  title: "LinkedIn",
  snapshot: line,
  gate: { needed: false, reason: "" },
});

describe("LinkedIn browser pacing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-16T10:02:00.000Z");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("navigates an early LinkedIn search without changing the timestamp", async () => {
    const ctx = context();
    ctx.store.settings.linkedinLastActionAt = "2026-09-16T10:00:00.000Z";
    vi.mocked(browserNavigate).mockResolvedValue(snapshot("Search results"));

    await executeTool(
      "browser_navigate",
      { url: "https://www.linkedin.com/search/results/people/?keywords=owner" },
      ctx
    );

    expect(browserNavigate).toHaveBeenCalledOnce();
    expect(ctx.store.settings.linkedinLastActionAt).toBe("2026-09-16T10:00:00.000Z");
  });

  it("runs a LinkedIn search after the gap without changing the timestamp", async () => {
    vi.setSystemTime("2026-09-16T10:06:00.000Z");
    const ctx = context();
    ctx.store.settings.linkedinLastActionAt = "2026-09-16T10:00:00.000Z";
    vi.mocked(browserNavigate).mockResolvedValue(snapshot("Search results"));

    await executeTool(
      "browser_navigate",
      { url: "https://www.linkedin.com/search/results/people/?keywords=owner" },
      ctx
    );

    expect(browserNavigate).toHaveBeenCalledOnce();
    expect(ctx.store.settings.linkedinLastActionAt).toBe("2026-09-16T10:00:00.000Z");
  });

  it("does not pace LinkedIn profiles or search paths on other sites", async () => {
    const ctx = context();
    ctx.store.settings.linkedinLastActionAt = "2026-09-16T10:01:00.000Z";
    vi.mocked(browserNavigate).mockResolvedValue(snapshot("Page"));

    await executeTool("browser_navigate", { url: "https://linkedin.com/in/x" }, ctx);
    await executeTool("browser_navigate", { url: "https://example.com/search/results/people/" }, ctx);

    expect(browserNavigate).toHaveBeenCalledTimes(2);
    expect(ctx.store.settings.linkedinLastActionAt).toBe("2026-09-16T10:01:00.000Z");
  });

  it("refuses an early LinkedIn send before creating approval", async () => {
    const ctx = context();
    ctx.store.settings.linkedinLastActionAt = "2026-09-16T10:00:00.000Z";
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot('[3] button "Send"'));

    const result = await executeTool("browser_click", { ref: 3 }, ctx);

    expect(result.result).toMatch(/^Refused:/);
    expect(result.approval).toBeUndefined();
    expect(browserClick).not.toHaveBeenCalled();
  });

  it("rechecks approved LinkedIn sends and records only the action that runs", async () => {
    const ctx = context();
    const sendApproval = approval("browser_click", {
      ref: 3,
      label: '[3] button "Send"',
    });
    ctx.store.settings.linkedinLastActionAt = "2026-09-16T10:00:00.000Z";
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot('[3] button "Send"'));
    vi.mocked(browserClick).mockResolvedValue({
      ...snapshot(""),
      blocked: false,
      result: "Clicked Send.",
      label: "Send",
    });

    const refused = await executeApprovedAction(sendApproval, ctx.bot, ctx.store);
    expect(refused).toMatch(/^LinkedIn pacing:/);
    expect(browserClick).not.toHaveBeenCalled();
    expect(ctx.store.settings.linkedinLastActionAt).toBe("2026-09-16T10:00:00.000Z");

    vi.setSystemTime("2026-09-16T10:46:00.000Z");
    await executeApprovedAction(sendApproval, ctx.bot, ctx.store);
    expect(browserClick).toHaveBeenCalledOnce();
    expect(ctx.store.settings.linkedinLastActionAt).toBe("2026-09-16T10:46:00.000Z");
  });

  it("uses a configured gap and defaults to forty-five minutes", async () => {
    vi.setSystemTime("2026-09-16T10:08:00.000Z");
    const paced = context();
    paced.store.settings.linkedinLastActionAt = "2026-09-16T10:00:00.000Z";
    paced.store.settings.linkedinGapSeconds = 600;

    vi.mocked(browserSnapshot).mockResolvedValue(snapshot('[3] button "Send"'));
    const refused = await executeTool("browser_click", { ref: 3 }, paced);
    expect(refused.result).toMatch(/^Refused:/);

    vi.setSystemTime("2026-09-16T10:46:00.000Z");
    const defaulted = context();
    defaulted.store.settings.linkedinLastActionAt = "2026-09-16T10:00:00.000Z";
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot('[3] button "Send"'));
    const allowed = await executeTool("browser_click", { ref: 3 }, defaulted);
    expect(allowed.approval).toBeUndefined();
  });

  it("refuses early LinkedIn typing that sends before creating approval", async () => {
    const ctx = context();
    ctx.store.settings.linkedinLastActionAt = "2026-09-16T10:00:00.000Z";
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot("Message box"));

    const result = await executeTool("browser_type", { text: "hello\n" }, ctx);

    expect(result.result).toMatch(/^LinkedIn pacing:/);
    expect(result.approval).toBeUndefined();
    expect(browserType).not.toHaveBeenCalled();
  });

  it("rechecks approved LinkedIn typing and records only the action that runs", async () => {
    const ctx = context();
    const typeApproval = approval("browser_type", { text: "hello\n" });
    ctx.store.settings.linkedinLastActionAt = "2026-09-16T10:00:00.000Z";
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot("Message box"));

    const refused = await executeApprovedAction(typeApproval, ctx.bot, ctx.store);
    expect(refused).toMatch(/^LinkedIn pacing:/);
    expect(browserType).not.toHaveBeenCalled();
    expect(ctx.store.settings.linkedinLastActionAt).toBe("2026-09-16T10:00:00.000Z");

    vi.setSystemTime("2026-09-16T10:46:00.000Z");
    vi.mocked(browserType).mockResolvedValue({
      ...snapshot(""),
      result: "Typed message.",
    });
    await executeApprovedAction(typeApproval, ctx.bot, ctx.store);
    expect(browserType).toHaveBeenCalledOnce();
    expect(ctx.store.settings.linkedinLastActionAt).toBe("2026-09-16T10:00:00.000Z");
  });

  it("rechecks approved LinkedIn Enter presses and records only the action that runs", async () => {
    const ctx = context();
    const pressApproval = approval("browser_press", { key: "Enter" });
    ctx.store.settings.linkedinLastActionAt = "2026-09-16T10:00:00.000Z";
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot("Message box"));

    const refused = await executeApprovedAction(pressApproval, ctx.bot, ctx.store);
    expect(refused).toMatch(/^LinkedIn pacing:/);
    expect(browserPress).not.toHaveBeenCalled();
    expect(ctx.store.settings.linkedinLastActionAt).toBe("2026-09-16T10:00:00.000Z");

    vi.setSystemTime("2026-09-16T10:46:00.000Z");
    vi.mocked(browserPress).mockResolvedValue({
      ...snapshot(""),
      result: "Pressed Enter.",
    });
    await executeApprovedAction(pressApproval, ctx.bot, ctx.store);
    expect(browserPress).toHaveBeenCalledOnce();
    expect(ctx.store.settings.linkedinLastActionAt).toBe("2026-09-16T10:46:00.000Z");
  });
});

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

function approval(toolName: string, args: Record<string, unknown>): PendingApproval {
  const ctx = context();
  return {
    id: "appr_test",
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

describe("browser action approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gates a send-like ref click even when the Bot passes approved true", async () => {
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot('[3] button "Send"'));

    const result = await executeTool("browser_click", { ref: 3, approved: true }, context());

    expect(result.approval).toBeUndefined();
    expect(result.result).toMatch(/^Refused:/);
    expect(browserClick).not.toHaveBeenCalled();
  });

  it("gates an x,y click with no ref", async () => {
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(""));

    const result = await executeTool("browser_click", { x: 100, y: 200 }, context());

    expect(result.approval).toBeUndefined();
    expect(result.result).toMatch(/^Refused:/);
    expect(browserClick).not.toHaveBeenCalled();
  });

  it.each(["Enter", "Meta+Enter", "NumpadEnter", "Shift+NumpadEnter", "numpadenter"])(
    "gates the %s keypress without pressing it",
    async (key) => {
      const result = await executeTool("browser_press", { key }, context());

      expect(result.approval?.kind).toBe("send");
      expect(browserPress).not.toHaveBeenCalled();
    }
  );

  it("presses Tab immediately without approval", async () => {
    expect(browserPress).not.toHaveBeenCalled();

    vi.mocked(browserPress).mockResolvedValue({
      ...snapshot(""),
      result: "Pressed Tab.",
    });
    const tab = await executeTool("browser_press", { key: "Tab" }, context());
    expect(tab.approval).toBeUndefined();
    expect(browserPress).toHaveBeenCalledWith("Tab");
  });

  it("gates typing text containing a newline without typing it", async () => {
    const newline = await executeTool("browser_type", { text: "hello\n" }, context());

    expect(newline.approval?.kind).toBe("send");
    expect(browserType).not.toHaveBeenCalled();
  });

  it("gates typing into a ref labelled Send without typing it", async () => {
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot('[5] button "Send"'));
    const sendRef = await executeTool("browser_type", { text: "hello", ref: 5 }, context());
    expect(sendRef.approval?.kind).toBe("send");
    expect(sendRef.approval?.args).toEqual({
      text: "hello",
      ref: 5,
      label: '[5] button "Send"',
    });
    expect(browserType).not.toHaveBeenCalled();
  });

  it("does not execute an approved ref click after its label changes", async () => {
    const ctx = context();
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot('[3] button "Delete"'));

    const result = await executeApprovedAction(
      approval("browser_click", { ref: 3, label: '[3] button "Send"' }),
      ctx.bot,
      ctx.store
    );

    expect(result).toMatch(/page changed.*new snapshot/i);
    expect(browserClick).not.toHaveBeenCalled();
  });

  it("does not execute approved typing after its ref label changes", async () => {
    const ctx = context();
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot('[5] button "Delete"'));

    const result = await executeApprovedAction(
      approval("browser_type", { text: "hello", ref: 5, label: '[5] button "Send"' }),
      ctx.bot,
      ctx.store
    );

    expect(result).toMatch(/page changed.*new snapshot/i);
    expect(browserType).not.toHaveBeenCalled();
  });

  it("executes an approved Enter keypress", async () => {
    const ctx = context();
    vi.mocked(browserPress).mockResolvedValue({
      ...snapshot(""),
      result: "Pressed Enter.",
    });

    await executeApprovedAction(approval("browser_press", { key: "Enter" }), ctx.bot, ctx.store);

    expect(browserPress).toHaveBeenCalledWith("Enter");
  });

  it("runs ordinary clicking and typing without approval", async () => {
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot('[4] button "Cancel"'));
    vi.mocked(browserClick).mockResolvedValue({
      ...snapshot(""),
      blocked: false,
      result: "Clicked Cancel.",
      label: "Cancel",
    });
    vi.mocked(browserType).mockResolvedValue({ ...snapshot(""), result: "Typed 5 characters." });

    const click = await executeTool("browser_click", { ref: 4 }, context());
    const type = await executeTool("browser_type", { text: "hello" }, context());

    expect(click.approval).toBeUndefined();
    expect(type.approval).toBeUndefined();
    expect(browserClick).toHaveBeenCalledWith({ ref: 4, x: undefined, y: undefined });
    expect(browserType).toHaveBeenCalledWith("hello", undefined);
  });
});
