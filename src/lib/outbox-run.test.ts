import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));
const handleUserMessage = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) => fn(state.store)),
}));
vi.mock("@/lib/agent/run", () => ({ handleUserMessage }));

import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import {
  getOutboxRun,
  onOutboxItemSettled,
  startOutboxRun,
  stopOutboxRun,
} from "@/lib/outbox-bot";
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

describe("outbox run", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-19T10:00:00.000Z");
    globalThis.__crewOutboxRun = undefined;
    state.store = createSeedStore();
    state.store.settings.linkedinSendWindowEnd = state.store.settings.linkedinSendWindowStart = "09:00";
    handleUserMessage.mockClear();
  });

  afterEach(() => vi.useRealTimers());

  it("paces and starts the next approved item after a send settles", async () => {
    const first = approved("Ada");
    const second = approved("Grace");
    state.store.settings.linkedinGapSeconds = 120;
    await startOutboxRun();
    first.status = "sent";
    state.store.settings.linkedinLastActionAt = new Date().toISOString();

    onOutboxItemSettled(state.store, "sent");
    expect(getOutboxRun().nextAt).toBe("2026-09-19T10:02:00.000Z");
    await vi.advanceTimersByTimeAsync(121_000);

    expect(second.status).toBe("sending");
    expect(handleUserMessage).toHaveBeenCalledTimes(2);
  });

  it("stops after failure or an operator stop", async () => {
    const first = approved("Ada");
    approved("Grace");
    await startOutboxRun();
    onOutboxItemSettled(state.store, "failed");
    expect(getOutboxRun()).toMatchObject({ active: false, reason: "Stopped after a failure." });

    globalThis.__crewOutboxRun = undefined;
    first.status = "sending";
    await startOutboxRun();
    stopOutboxRun();
    first.status = "sent";
    onOutboxItemSettled(state.store, "sent");
    expect(getOutboxRun().active).toBe(false);
    expect(handleUserMessage).toHaveBeenCalledTimes(1);
  });
});
