import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));
const handleUserMessage = vi.hoisted(() => vi.fn(async () => undefined));
const closeLeftovers = vi.hoisted(() => vi.fn(async () => [] as string[]));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) => fn(state.store)),
}));
vi.mock("@/lib/agent/run", () => ({ handleUserMessage }));
vi.mock("@/lib/outbox-leftovers", () => ({
  closeLeftoverLinkedInConversations: closeLeftovers,
}));

import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { startOutboxRun, stopOutboxRun } from "@/lib/outbox-bot";
import { createSeedStore } from "@/lib/seed";

function approved(kind: "message" | "invite") {
  const item = createOutboxItem(state.store, {
    name: "Ada",
    profileUrl: "https://www.linkedin.com/in/ada",
    text: "Hello Ada",
    kind,
    createdBy: "operator",
  });
  approveOutboxItems(state.store, { ids: [item.id] });
  return item;
}

describe("Outbox leftover cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-25T13:00:00.000Z");
    globalThis.__crewOutboxRun = undefined;
    state.store = createSeedStore();
    state.store.settings.linkedinSendWindowStart = "00:00";
    state.store.settings.linkedinSendWindowEnd = "23:59";
    state.store.settings.outboxDirectInvites = false;
    handleUserMessage.mockClear();
    closeLeftovers.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    stopOutboxRun();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("cleans up before starting an approved message Bot turn", async () => {
    approved("message");

    await startOutboxRun();

    expect(closeLeftovers).toHaveBeenCalledOnce();
    expect(handleUserMessage).toHaveBeenCalledOnce();
    expect(closeLeftovers.mock.invocationCallOrder[0]).toBeLessThan(
      handleUserMessage.mock.invocationCallOrder[0]
    );
  });

  it("does not clean up before an approved invite", async () => {
    approved("invite");

    await startOutboxRun();

    expect(closeLeftovers).not.toHaveBeenCalled();
    expect(handleUserMessage).toHaveBeenCalledOnce();
  });

  it("still starts a message when cleanup rejects", async () => {
    const item = approved("message");
    closeLeftovers.mockRejectedValueOnce(new Error("browser unavailable"));

    await expect(startOutboxRun()).resolves.toMatchObject({ started: true, itemId: item.id });
    expect(item.status).toBe("sending");
    expect(handleUserMessage).toHaveBeenCalledOnce();
  });
});
