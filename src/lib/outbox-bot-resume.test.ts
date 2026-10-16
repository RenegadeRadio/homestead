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
  resumeOutboxRunOnBoot,
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

describe("persisted outbox run", () => {
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

  it("persists starts and settled stops", async () => {
    const item = approved();
    await startOutboxRun();
    expect(state.store.settings.outboxRunActive).toBe(true);

    stopOutboxRun();
    item.status = "sent";
    onOutboxItemSettled(state.store, "sent");
    expect(state.store.settings.outboxRunActive).toBe(false);
  });

  it("persists completion after the last approved item", async () => {
    const item = approved();
    await startOutboxRun();
    item.status = "sent";
    onOutboxItemSettled(state.store, "sent");

    expect(getOutboxRun()).toMatchObject({ active: false, reason: "Done." });
    expect(state.store.settings.outboxRunActive).toBe(false);
  });

  it("resumes an eligible persisted run", async () => {
    approved();
    state.store.settings.outboxRunActive = true;

    await resumeOutboxRunOnBoot();

    expect(getOutboxRun().active).toBe(true);
    expect(handleUserMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["inactive", false, "approved"],
    ["sending", true, "sending"],
  ] as const)("does not resume when %s", async (_name, active, status) => {
    const item = approved();
    item.status = status;
    state.store.settings.outboxRunActive = active;

    await resumeOutboxRunOnBoot();

    expect(getOutboxRun().active).toBe(false);
    expect(handleUserMessage).not.toHaveBeenCalled();
  });

  it("does not resume when another item is sending", async () => {
    approved();
    const sendingItem = approved();
    sendingItem.status = "sending";
    state.store.settings.outboxRunActive = true;

    await resumeOutboxRunOnBoot();

    expect(getOutboxRun().active).toBe(false);
    expect(handleUserMessage).not.toHaveBeenCalled();
  });

  it("does not resume when the LinkedIn hold is set", async () => {
    approved();
    state.store.settings.outboxRunActive = true;
    state.store.settings.linkedinHold = "operator hold";

    await resumeOutboxRunOnBoot();

    expect(getOutboxRun().active).toBe(false);
    expect(handleUserMessage).not.toHaveBeenCalled();
  });
});
