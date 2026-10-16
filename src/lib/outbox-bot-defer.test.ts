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
  deferOutboxRun,
  getOutboxRun,
  onOutboxItemSettled,
  startOutboxRun,
  stopOutboxRun,
} from "@/lib/outbox-bot";
import { createSeedStore } from "@/lib/seed";

function approved() {
  const item = createOutboxItem(state.store, {
    name: "Ada",
    profileUrl: "https://www.linkedin.com/in/ada",
    text: "Hello Ada",
    createdBy: "operator",
  });
  approveOutboxItems(state.store, { ids: [item.id] });
  return item;
}

describe("deferred outbox run", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-21T10:00:00.000Z");
    globalThis.__crewOutboxRun = undefined;
    state.store = createSeedStore();
    handleUserMessage.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("stays active and retries at the pacing deadline", async () => {
    const item = approved();
    await startOutboxRun();
    item.status = "approved";
    delete item.sendingAt;
    const nextAllowedAt = new Date("2026-09-21T10:02:00.000Z");

    deferOutboxRun(state.store, nextAllowedAt);

    expect(getOutboxRun()).toMatchObject({
      active: true,
      nextAt: nextAllowedAt.toISOString(),
    });
    await vi.advanceTimersByTimeAsync(121_000);
    expect(item.status).toBe("sending");
    expect(handleUserMessage).toHaveBeenCalledTimes(2);
  });

  it("keeps the run active when pacing defers an approved item", async () => {
    const item = approved();
    state.store.settings.linkedinGapSeconds = 2700;
    state.store.settings.linkedinLastActionAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const expected = new Date(
      new Date(state.store.settings.linkedinLastActionAt).getTime() + 2700 * 1000
    ).toISOString();

    const result = await startOutboxRun();

    expect(result.started).toBe(false);
    expect(getOutboxRun()).toMatchObject({ active: true, nextAt: expected });
    expect(item.status).toBe("approved");
  });

  it("starts the approved item after the pacing deadline", async () => {
    const item = approved();
    state.store.settings.linkedinGapSeconds = 2700;
    state.store.settings.linkedinLastActionAt = new Date(Date.now() - 10 * 60_000).toISOString();

    await startOutboxRun();
    await vi.advanceTimersByTimeAsync(35 * 60_000 + 2_000);

    expect(item.status).toBe("sending");
    expect(handleUserMessage).toHaveBeenCalledTimes(1);
  });

  it("does not schedule a retry after a stop is requested", async () => {
    approved();
    await startOutboxRun();
    stopOutboxRun();

    deferOutboxRun(state.store, new Date("2026-09-21T10:02:00.000Z"));

    expect(getOutboxRun().nextAt).toBeNull();
    await vi.advanceTimersByTimeAsync(121_000);
    expect(handleUserMessage).toHaveBeenCalledTimes(1);
  });

  it("still stops a run after a real failure", async () => {
    approved();
    await startOutboxRun();

    onOutboxItemSettled(state.store, "failed");

    expect(getOutboxRun()).toMatchObject({
      active: false,
      reason: "Stopped after a failure.",
    });
  });
});
