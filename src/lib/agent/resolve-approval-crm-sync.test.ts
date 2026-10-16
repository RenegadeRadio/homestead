import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: { store?: unknown } = {};
  return {
    state,
    getStore: vi.fn(async () => state.store),
    updateStore: vi.fn(async (fn: (store: unknown) => unknown) => fn(state.store)),
    persistStore: vi.fn(async () => {}),
    syncPendingSends: vi.fn(),
  };
});

vi.mock("@/lib/store", () => ({
  getStore: mocks.getStore,
  updateStore: mocks.updateStore,
  persistStore: mocks.persistStore,
  __setStore: (store: unknown) => { mocks.state.store = store; },
}));
vi.mock("@/lib/crm/notion-sync", () => ({ syncPendingSends: mocks.syncPendingSends }));

import { resolveApproval } from "@/lib/agent/run";
import { createSeedStore } from "@/lib/seed";
import * as storeModule from "@/lib/store";
import type { Store } from "@/lib/types";

function setApprovedAction() {
  const store = createSeedStore();
  const bot = store.bots[0];
  const conversation = store.conversations[0];
  store.messages.push({
    id: "msg_approval",
    conversationId: conversation.id,
    role: "assistant",
    botId: bot.id,
    parts: [],
    createdAt: "2026-09-16T00:00:00.000Z",
    reactions: [],
  });
  store.pendingApprovals.push({
    id: "appr_sync",
    conversationId: conversation.id,
    messageId: "msg_approval",
    botId: bot.id,
    toolName: "list_files",
    args: {},
    createdAt: "2026-09-16T00:00:00.000Z",
    checkpoint: [],
  });
  const mockedStore = storeModule as typeof storeModule & { __setStore(value: Store): void };
  mockedStore.__setStore(store);
  return store;
}

describe("resolveApproval CRM sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setApprovedAction();
    mocks.syncPendingSends.mockResolvedValue({});
  });

  it("syncs pending sends once after the store update finishes", async () => {
    const order: string[] = [];
    mocks.persistStore.mockImplementation(async () => {
      order.push("persist-done");
    });
    mocks.syncPendingSends.mockImplementationOnce(async () => {
      order.push("sync-called");
      return {};
    });
    await resolveApproval({ approvalId: "appr_sync", decision: "approved", emit: vi.fn() });
    expect(mocks.syncPendingSends).toHaveBeenCalledTimes(1);
    expect(order.slice(0, -1).every((entry) => entry === "persist-done")).toBe(true);
    expect(order).toContain("persist-done");
    expect(order.at(-1)).toBe("sync-called");
  });

  it("still emits done and no error when CRM sync rejects", async () => {
    mocks.syncPendingSends.mockRejectedValueOnce(new Error("notion down"));
    const emit = vi.fn();
    await resolveApproval({ approvalId: "appr_sync", decision: "approved", emit });
    expect(emit).toHaveBeenCalledWith({ type: "done" });
    expect(emit.mock.calls.some(([event]) => event.type === "error")).toBe(false);
  });
});
