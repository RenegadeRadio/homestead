import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) => fn(state.store)),
}));
vi.mock("@/lib/agent/run", () => ({ handleUserMessage: vi.fn() }));

import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { getOutboxRun, startOutboxRun, stopOutboxRun } from "@/lib/outbox-bot";
import { createSeedStore } from "@/lib/seed";

describe("Outbox LinkedIn send window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-22T17:00:00.000Z");
    state.store = createSeedStore();
    const item = createOutboxItem(state.store, {
      name: "Ada",
      profileUrl: "https://www.linkedin.com/in/ada",
      text: "Hello Ada",
      createdBy: "operator",
    });
    approveOutboxItems(state.store, { ids: [item.id] });
  });

  afterEach(() => {
    stopOutboxRun();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("defers a 19:00 SAST run until 09:00 SAST the next day", async () => {
    const result = await startOutboxRun();
    expect(result.started).toBe(false);
    expect(getOutboxRun().nextAt).toBe("2026-09-23T07:00:00.000Z");
  });

  it("defers an approved invite at the daily cap without changing its status", async () => {
    vi.setSystemTime("2026-09-25T13:00:00.000Z");
    state.store = createSeedStore();
    const item = createOutboxItem(state.store, {
      name: "Grace",
      profileUrl: "https://www.linkedin.com/in/grace",
      text: "Hello Grace",
      kind: "invite",
      createdBy: "operator",
    });
    approveOutboxItems(state.store, { ids: [item.id] });
    state.store.linkedinSendLog = Array.from({ length: 10 }, (_, index) => ({
      id: `send-${index}`,
      at: new Date(Date.now() - (index + 1) * 60_000).toISOString(),
      botId: "bot",
      conversationId: "conversation",
      messageId: "message",
      url: "https://www.linkedin.com/in/test",
      slug: "test",
      action: "click" as const,
      label: '[1] button "Send"',
      key: null,
      text: null,
      kind: "invite" as const,
    }));

    const result = await startOutboxRun();

    expect(result.started).toBe(false);
    expect(result.started === false && result.reason).toMatch(/^LinkedIn invite cap:/);
    expect(result.started === false && result.nextAllowedAt?.toISOString()).toBe(
      "2026-09-28T07:00:00.000Z"
    );
    expect(item.status).toBe("approved");
  });
});
