import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserSnapshot: vi.fn(),
    browserClick: vi.fn(),
    browserComposeText: vi.fn(),
    browserType: vi.fn(),
  };
});

import { browserClick, browserComposeText, browserSnapshot, browserType } from "@/lib/browser";
import { executeApprovedAction, executeTool, type ToolContext } from "@/lib/agent/execute";
import { typedTextFor } from "@/lib/agent/linkedin-send-log";
import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { createSeedStore } from "@/lib/seed";

const adaUrl = "https://www.linkedin.com/in/ada-lovelace";
const bobUrl = "https://www.linkedin.com/in/bob-babbage";

function snapshot(url: string, line: string) {
  return {
    url,
    title: "LinkedIn",
    snapshot: line,
    gate: { needed: false, reason: "" },
  };
}

function context(options: {
  kind?: "message" | "invite";
  sending?: boolean;
  profileUrl?: string;
} = {}) {
  const store = createSeedStore();
  store.settings.linkedinActionGapMinSeconds = 0;
  store.settings.linkedinActionGapMaxSeconds = 0;
  store.settings.linkedinSendWindowEnd = store.settings.linkedinSendWindowStart = "09:00";
  const item = createOutboxItem(store, {
    name: "Ada Lovelace",
    profileUrl: options.profileUrl ?? adaUrl,
    text: "Hello Ada",
    kind: options.kind ?? "message",
    createdBy: "operator",
  });
  approveOutboxItems(store, { ids: [item.id] });
  if (options.sending !== false) item.status = "sending";
  const ctx: ToolContext = {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
  };
  return { ctx, item };
}

describe("executeTool Outbox pre-approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(browserType).mockImplementation(async (text) => ({
      ...snapshot(adaUrl, ""),
      result: `Typed ${text}`,
    }));
    vi.mocked(browserClick).mockResolvedValue({
      ...snapshot(adaUrl, ""),
      blocked: false,
      result: "Clicked.",
      label: "Send",
    });
  });

  it("asks once when typing the approved text", async () => {
    const { ctx } = context();
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(adaUrl, "Message box"));

    const outcome = await executeTool("browser_type", { text: "Hello Ada\n" }, ctx);

    expect(outcome.approval?.kind).toBe("send");
    expect(outcome.result).toContain("Send to Ada Lovelace?");
    expect(browserType).not.toHaveBeenCalled();
  });

  it("asks again when typed text differs from the approved text", async () => {
    const { ctx } = context();
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(adaUrl, "Message box"));

    const outcome = await executeTool("browser_type", { text: "Hello Bob\n" }, ctx);

    expect(outcome.approval?.kind).toBe("send");
    expect(browserType).not.toHaveBeenCalled();
  });

  it("types an approved invite without a second approval when enabled", async () => {
    const { ctx } = context({ kind: "invite" });
    ctx.store.settings.outboxSendWithoutFinalApproval = true;
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(adaUrl, "Invitation dialog"));

    const outcome = await executeTool("browser_type", { text: "Hello Ada\n" }, ctx);

    expect(outcome.approval).toBeUndefined();
    expect(browserType).toHaveBeenCalledWith("Hello Ada\n", undefined);
    expect(ctx.store.computerLogs[0].summary).toBe("Outbox approved text typed: Ada Lovelace");
  });

  it("still asks for browser typing approval for changed Outbox text when enabled", async () => {
    const { ctx } = context({ kind: "invite" });
    ctx.store.settings.outboxSendWithoutFinalApproval = true;
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(adaUrl, "Invitation dialog"));

    const outcome = await executeTool("browser_type", { text: "Hello Bob\n" }, ctx);

    expect(outcome.approval?.kind).toBe("send");
    expect(outcome.result).toContain("Approve browser typing?");
    expect(browserType).not.toHaveBeenCalled();
  });

  it("sends a typed approved message, records it, and settles its item", async () => {
    const profileUrl = `${adaUrl}-message`;
    const { ctx, item } = context({ profileUrl });
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(profileUrl, "Message box"));
    vi.mocked(browserType).mockResolvedValue({
      ...snapshot(profileUrl, ""),
      result: "Typed.",
    });
    const outcome = await executeTool("browser_type", { text: "Hello Ada\n" }, ctx);
    expect(outcome.approval?.kind).toBe("send");
    await executeApprovedAction(outcome.approval!, ctx.bot, ctx.store);
    expect(typedTextFor(profileUrl)).toBe("Hello Ada\n");
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(profileUrl, '[4] button "Send"'));
    vi.mocked(browserComposeText).mockResolvedValue("Ada Lovelace");

    const sendOutcome = await executeTool("browser_click", { ref: 4 }, ctx);

    expect(sendOutcome.approval).toBeUndefined();
    expect(browserClick).toHaveBeenCalledWith({ ref: 4, x: undefined, y: undefined });
    expect(ctx.store.linkedinSendLog).toHaveLength(1);
    expect(ctx.store.linkedinSendLog?.[0]).toMatchObject({ kind: "message", text: "Hello Ada\n" });
    expect(item.status).toBe("sent");
  });

  it("asks again for Send on a different profile", async () => {
    const { ctx } = context();
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(bobUrl, '[4] button "Send"'));

    const outcome = await executeTool("browser_click", { ref: 4 }, ctx);

    expect(outcome.approval?.kind).toBe("send");
    expect(browserClick).not.toHaveBeenCalled();
  });

  it("still asks for approval for an x,y click when nothing is sending", async () => {
    const { ctx } = context({ sending: false });
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(adaUrl, ""));

    const outcome = await executeTool("browser_click", { x: 10, y: 20 }, ctx);

    expect(outcome.approval).toBeUndefined();
    expect(browserClick).not.toHaveBeenCalled();
  });

  it("refuses an x,y click when an Outbox item is sending", async () => {
    const { ctx } = context();
    const computerLogCount = ctx.store.computerLogs.length;
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(adaUrl, ""));

    const outcome = await executeTool("browser_click", { x: 10, y: 20 }, ctx);

    expect(outcome.result).toBe(
      "An Outbox item is sending. Take a browser_snapshot and click by ref — a click with only x,y records nothing and cannot finish the item."
    );
    expect(outcome.approval).toBeUndefined();
    expect(browserClick).not.toHaveBeenCalled();
    expect(ctx.store.computerLogs).toHaveLength(computerLogCount);
  });

  it("clicks the named invite Connect action without asking again", async () => {
    const { ctx } = context({ kind: "invite" });
    vi.mocked(browserSnapshot).mockResolvedValue(
      snapshot(adaUrl, '[4] button "Invite Ada Lovelace to connect"')
    );

    const outcome = await executeTool("browser_click", { ref: 4 }, ctx);

    expect(outcome.approval).toBeUndefined();
    expect(browserClick).toHaveBeenCalledWith({ ref: 4, x: undefined, y: undefined });
  });

  it("clicks a ref carried alongside x,y instead of refusing it", async () => {
    const { ctx } = context({ kind: "invite" });
    vi.mocked(browserSnapshot).mockResolvedValue(
      snapshot(adaUrl, '[4] button "Invite Ada Lovelace to connect"')
    );

    const outcome = await executeTool("browser_click", { ref: 4, x: 10, y: 20 }, ctx);

    expect(outcome.approval).toBeUndefined();
    expect(outcome.result).not.toBe(
      "An Outbox item is sending. Take a browser_snapshot and click by ref — a click with only x,y records nothing and cannot finish the item."
    );
    expect(browserClick).toHaveBeenCalledWith({ ref: 4, x: undefined, y: undefined });
  });

  it("keeps the existing approval gate when no item is sending", async () => {
    const { ctx } = context({ sending: false });
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot(adaUrl, '[4] button "Send"'));

    const outcome = await executeTool("browser_click", { ref: 4 }, ctx);

    expect(outcome.approval).toBeUndefined();
    expect(browserClick).not.toHaveBeenCalled();
  });
});
