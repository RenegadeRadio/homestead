import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));
const handleUserMessage = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) => fn(state.store)),
  persistStore: vi.fn(async () => undefined),
}));
vi.mock("@/lib/agent/run", () => ({
  handleUserMessage,
  stopConversation: vi.fn(),
}));
vi.mock("@/lib/outbox-leftovers", () => ({
  closeLeftoverLinkedInConversations: vi.fn(async () => []),
}));
vi.mock("@/lib/outbox-aftermath", () => ({
  measureOutboxAftermath: vi.fn(async () => undefined),
}));

import { executeTool, type ToolContext } from "@/lib/agent/execute";
import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { getOutboxRun, onOutboxItemSettled, startOutboxRun } from "@/lib/outbox-bot";
import { createSeedStore } from "@/lib/seed";

function approved(name: string) {
  const item = createOutboxItem(state.store, {
    name,
    profileUrl: `https://www.linkedin.com/in/${name.toLowerCase()}`,
    text: `Hello ${name}`,
    createdBy: "operator",
  });
  approveOutboxItems(state.store, { ids: [item.id] });
  return item;
}

function context(): ToolContext {
  return {
    store: state.store,
    bot: state.store.bots[0],
    conversationId: state.store.conversations[0].id,
    messageId: state.store.messages[0].id,
  };
}

describe("Outbox already-messaged guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-10-10T10:00:00.000Z");
    globalThis.__crewOutboxRun = undefined;
    state.store = createSeedStore();
    state.store.settings.linkedinSendWindowStart = "00:00";
    state.store.settings.linkedinSendWindowEnd = "23:59";
    state.store.settings.linkedinSendWeekdaysOnly = false;
    handleUserMessage.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("skips a guarded item and carries on with the next approved item", async () => {
    const first = approved("Ada");
    const second = approved("Grace");
    await startOutboxRun();

    const outcome = await executeTool(
      "record_linkedin_thread",
      {
        profileUrl: first.profileUrl,
        lastFromOperatorAt: "2026-10-08T10:00:00.000Z",
        lastFromOperatorLine: "Thanks for reaching out",
      },
      context()
    );

    expect(first.status).toBe("failed");
    expect(first.error).toMatch(/^Already messaged on/);
    expect(outcome.result).toBe(`Stopped the send to Ada: ${first.error}`);
    expect(state.store.computerLogs.some((log) => log.summary.startsWith("Outbox skipped"))).toBe(true);
    expect(getOutboxRun()).toMatchObject({ active: true });
    expect(getOutboxRun().nextAt).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1_001);

    expect(second.status).toBe("sending");
  });

  it("logs approved items left when a genuine failure stops the run", async () => {
    approved("Ada");
    approved("Grace");
    approved("Katherine");
    await startOutboxRun();

    onOutboxItemSettled(state.store, "failed");

    expect(getOutboxRun()).toMatchObject({
      active: false,
      reason: "Stopped after a failure.",
    });
    expect(state.store.computerLogs[0].summary).toBe(
      "Outbox run stopped after a failure with 2 approved items not sent."
    );
  });
});
