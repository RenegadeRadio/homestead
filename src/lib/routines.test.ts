import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));
const handleUserMessage = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) => fn(state.store)),
}));
vi.mock("@/lib/agent/run", () => ({ handleUserMessage }));

import { tickRoutines } from "@/lib/routines";
import { createSeedStore } from "@/lib/seed";

describe("routine ticker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-24T06:30:00.000Z");
    state.store = createSeedStore();
    state.store.routines.push({
      id: "r1",
      name: "Inbound",
      botId: "b",
      conversationId: "c",
      prompt: "go",
      cron: "*/5 * * * *",
      timezone: "UTC",
      enabled: true,
      nextRunAt: "2026-09-24T06:29:00.000Z",
      createdAt: "2026-09-24T06:00:00.000Z",
    });
    handleUserMessage.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("runs a due routine only once while its turn is still running", async () => {
    let release!: () => void;
    handleUserMessage.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => { release = () => resolve(undefined); })
    );

    const first = tickRoutines();
    await vi.waitFor(() => expect(handleUserMessage).toHaveBeenCalledTimes(1));
    await tickRoutines();

    expect(handleUserMessage).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it("advances the next run before starting the turn", async () => {
    let nextRunAtWhenCalled = 0;
    handleUserMessage.mockImplementationOnce(async () => {
      nextRunAtWhenCalled = Date.parse(state.store.routines[0].nextRunAt!);
    });

    await tickRoutines();

    expect(nextRunAtWhenCalled).toBeGreaterThan(Date.now());
    expect(state.store.routines[0].lastRunAt).toBe("2026-09-24T06:30:00.000Z");
  });

  it("can run again after a turn throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    handleUserMessage.mockRejectedValueOnce(new Error("turn failed"));

    await tickRoutines();
    expect(handleUserMessage).toHaveBeenCalledTimes(1);

    vi.setSystemTime("2026-09-24T06:36:00.000Z");
    handleUserMessage.mockResolvedValueOnce(undefined);
    await tickRoutines();

    expect(handleUserMessage).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("does not start a second turn when the routine falls due again while its turn is still running", async () => {
    let release!: () => void;
    handleUserMessage.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => { release = () => resolve(undefined); })
    );

    const first = tickRoutines();
    await vi.waitFor(() => expect(handleUserMessage).toHaveBeenCalledTimes(1));

    state.store.routines[0].nextRunAt = "2026-09-24T06:29:00.000Z";
    await tickRoutines();

    expect(handleUserMessage).toHaveBeenCalledTimes(1);
    release();
    await first;

    state.store.routines[0].nextRunAt = "2026-09-24T06:29:00.000Z";
    handleUserMessage.mockResolvedValueOnce(undefined);
    await tickRoutines();

    expect(handleUserMessage).toHaveBeenCalledTimes(2);
  });
});
