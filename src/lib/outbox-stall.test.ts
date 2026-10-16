import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));
const handleUserMessage = vi.hoisted(() => vi.fn(async () => undefined));
const stopConversation = vi.hoisted(() => vi.fn());

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) => fn(state.store)),
}));
vi.mock("@/lib/agent/run", () => ({ handleUserMessage, stopConversation }));

import { countLinkedInInvitesLast7Days } from "@/lib/agent/linkedin-budget";
import { recordLinkedInSend } from "@/lib/agent/linkedin-send-log";
import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { getOutboxRun, startOutboxRun } from "@/lib/outbox-bot";
import { createSeedStore } from "@/lib/seed";

function approved(name: string, kind?: "invite") {
  const item = createOutboxItem(state.store, {
    name,
    profileUrl: `https://www.linkedin.com/in/${name.toLowerCase()}`,
    text: `Hello ${name}`,
    createdBy: "operator",
    kind,
  });
  approveOutboxItems(state.store, { ids: [item.id] });
  return item;
}

describe("stalled outbox items", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-21T10:00:00.000Z");
    globalThis.__crewOutboxRun = undefined;
    state.store = createSeedStore();
    state.store.settings.outboxStallMinutes = 30;
    state.store.settings.linkedinSendWindowEnd =
      state.store.settings.linkedinSendWindowStart = "09:00";
    handleUserMessage.mockClear();
    stopConversation.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("sets a stalled item aside and continues the active run", async () => {
    const first = approved("Ada");
    const second = approved("Grace");
    await startOutboxRun();

    await vi.advanceTimersByTimeAsync(30 * 60_000 + 2_000);

    expect(first.status).toBe("failed");
    expect(first.error).toMatch(/^Stalled:/);
    expect(second.status).toBe("sending");
    expect(getOutboxRun()).toMatchObject({ active: true });
    expect(getOutboxRun().reason).not.toBe("Stopped after a failure.");
    expect(stopConversation).toHaveBeenCalledTimes(1);
  });

  it("counts a stalled invite once and voids it when re-approved", async () => {
    const item = approved("Ada", "invite");
    await startOutboxRun();
    await vi.advanceTimersByTimeAsync(30 * 60_000);

    const entry = state.store.linkedinSendLog?.find(
      (candidate) => candidate.outboxItemId === item.id && candidate.stalled
    );
    expect(entry).toMatchObject({ kind: "invite", label: null, stalled: true });
    expect(countLinkedInInvitesLast7Days(new Date(), state.store.linkedinSendLog)).toBe(1);

    approveOutboxItems(state.store, { ids: [item.id] });

    expect(entry?.voidedAt).toBeTruthy();
    expect(countLinkedInInvitesLast7Days(new Date(), state.store.linkedinSendLog)).toBe(0);
  });

  it("does not set aside an item with newer profile activity", async () => {
    const item = approved("Ada");
    await startOutboxRun();
    recordLinkedInSend(state.store, {
      botId: "bot",
      conversationId: "conversation",
      messageId: "activity",
      url: item.profileUrl,
      action: "click",
      label: null,
      kind: "unknown",
      at: new Date(Date.now() + 1_000).toISOString(),
    });

    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1_000);

    expect(item.status).toBe("sending");
    expect(stopConversation).not.toHaveBeenCalled();
  });
});
