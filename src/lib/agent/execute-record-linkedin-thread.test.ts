import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserSnapshot: vi.fn(),
    browserType: vi.fn(),
  };
});

import { executeTool, type ToolContext } from "@/lib/agent/execute";
import { browserSnapshot, browserType } from "@/lib/browser";
import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { createSeedStore } from "@/lib/seed";

const profileUrl = "https://www.linkedin.com/in/ada-lovelace";

function context(kind: "message" | "invite") {
  const store = createSeedStore();
  store.settings.linkedinSendWindowEnd = store.settings.linkedinSendWindowStart = "09:00";
  const item = createOutboxItem(store, {
    name: "Ada Lovelace",
    profileUrl,
    text: "Hello Ada",
    kind,
    createdBy: "operator",
  });
  item.kind = kind;
  approveOutboxItems(store, { ids: [item.id] });
  item.status = "sending";
  const ctx: ToolContext = {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
  };
  return { ctx, item };
}

describe("record_linkedin_thread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(browserSnapshot).mockResolvedValue({
      url: profileUrl,
      title: "LinkedIn",
      snapshot: "Message box",
      gate: { needed: false, reason: "" },
    });
  });

  it("refuses to type a message before its thread is read", async () => {
    const { ctx } = context("message");

    const outcome = await executeTool("browser_type", { text: "Hello Ada\n" }, ctx);

    expect(outcome.result).toContain("record_linkedin_thread");
    expect(outcome.approval).toBeUndefined();
    expect(browserType).not.toHaveBeenCalled();
  });

  it("allows the normal send approval after recording no operator message", async () => {
    const { ctx, item } = context("message");

    await executeTool("record_linkedin_thread", { profileUrl }, ctx);
    const outcome = await executeTool("browser_type", { text: "Hello Ada\n" }, ctx);

    expect(item.threadRead?.at).toBeTruthy();
    expect(outcome.approval?.kind).toBe("send");
  });

  it("fails an item when the operator messaged within the window", async () => {
    const { ctx, item } = context("message");

    const outcome = await executeTool(
      "record_linkedin_thread",
      {
        profileUrl,
        lastFromOperatorAt: new Date().toISOString(),
        lastFromOperatorLine: "Good to meet you",
      },
      ctx
    );

    expect(item.status).toBe("failed");
    expect(item.error).toMatch(/^Already messaged on /);
    expect(outcome.result).toContain("Stopped the send");
  });

  it("keeps invite typing on the normal approval path without a thread read", async () => {
    const { ctx, item } = context("invite");

    const outcome = await executeTool("browser_type", { text: "Hello Ada\n" }, ctx);

    expect(item.threadRead).toBeUndefined();
    expect(outcome.approval?.kind).toBe("send");
  });

  it("called with a profile URL matching no sending Outbox item records nothing and returns a result saying so", async () => {
    const { ctx, item } = context("message");
    const otherProfileUrl = "https://www.linkedin.com/in/grace-hopper";

    const outcome = await executeTool(
      "record_linkedin_thread",
      { profileUrl: otherProfileUrl },
      ctx
    );

    expect(outcome.result).toBe(
      `No sending Outbox item matched ${otherProfileUrl}; nothing was recorded.`
    );
    expect(item.threadRead).toBeUndefined();
  });
});
