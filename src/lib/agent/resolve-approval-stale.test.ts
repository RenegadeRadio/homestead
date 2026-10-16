import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: { store?: unknown } = {};
  return {
    state,
    executeApprovedAction: vi.fn(),
    executeTool: vi.fn(),
    getStore: vi.fn(async () => state.store),
    updateStore: vi.fn(async (fn: (store: unknown) => unknown) => fn(state.store)),
    persistStore: vi.fn(async () => {}),
    syncPendingSends: vi.fn(async () => ({})),
  };
});

vi.mock("@/lib/agent/execute", () => ({
  executeApprovedAction: mocks.executeApprovedAction,
  executeTool: mocks.executeTool,
}));
vi.mock("@/lib/store", () => ({
  getStore: mocks.getStore,
  updateStore: mocks.updateStore,
  persistStore: mocks.persistStore,
}));
vi.mock("@/lib/crm/notion-sync", () => ({ syncPendingSends: mocks.syncPendingSends }));

import { resolveApproval } from "@/lib/agent/run";
import { createSeedStore } from "@/lib/seed";

function approvalStore(withNewerMessage: boolean) {
  const store = createSeedStore();
  const bot = store.bots.find((item) => item.id === "bot_scout")!;
  const conversation = store.conversations.find((item) => item.botIds.includes(bot.id))!;
  store.messages.push({
    id: "msg_stale_approval",
    conversationId: conversation.id,
    role: "assistant",
    botId: bot.id,
    parts: [
      { type: "approval", id: "appr_stale_guard", title: "Needs you", detail: "x", status: "pending" },
    ],
    createdAt: "2026-09-17T12:46:00.000Z",
    reactions: [],
  });
  store.pendingApprovals.push({
    id: "appr_stale_guard",
    conversationId: conversation.id,
    messageId: "msg_stale_approval",
    botId: bot.id,
    toolName: "run_command",
    args: {},
    createdAt: "2026-09-17T12:46:00.000Z",
    checkpoint: [],
  });
  if (withNewerMessage) {
    store.messages.push({
      id: "msg_newer_scout_work",
      conversationId: conversation.id,
      role: "assistant",
      botId: bot.id,
      parts: [{ type: "text", text: "newer work" }],
      createdAt: "2026-09-17T14:14:00.000Z",
      reactions: [],
    });
  }
  mocks.state.store = store;
  return store;
}

describe("resolveApproval stale approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeApprovedAction.mockResolvedValue("ok");
  });

  it("refuses an approval when the bot has started newer work", async () => {
    const store = approvalStore(true);
    const emit = vi.fn();

    await resolveApproval({ approvalId: "appr_stale_guard", decision: "approved", emit });

    expect(mocks.executeApprovedAction).not.toHaveBeenCalled();
    expect(store.pendingApprovals).not.toContainEqual(
      expect.objectContaining({ id: "appr_stale_guard" })
    );
    expect(store.messages.find((item) => item.id === "msg_stale_approval")?.parts[0]).toMatchObject({
      type: "approval",
      status: "denied",
    });
    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      {
        type: "error",
        message: "This request is out of date: Scout has started newer work. Ask again if it is still needed.",
      },
      { type: "done" },
    ]);
  });

  it("executes an approval when the bot has no newer message", async () => {
    approvalStore(false);

    await resolveApproval({
      approvalId: "appr_stale_guard",
      decision: "approved",
      emit: vi.fn(),
    });

    expect(mocks.executeApprovedAction).toHaveBeenCalledTimes(1);
  });
});
