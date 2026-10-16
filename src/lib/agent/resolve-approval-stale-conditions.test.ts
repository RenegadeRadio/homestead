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

function approvalStore(messageCreatedAt = "2026-09-17T12:46:00.000Z") {
  const store = createSeedStore();
  const bot = store.bots.find((item) => item.id === "bot_scout")!;
  const conversation = store.conversations.find((item) => item.id === "convo_desk")!;
  store.messages.push({
    id: "msg_guarded_approval",
    conversationId: conversation.id,
    role: "assistant",
    botId: bot.id,
    parts: [
      { type: "approval", id: "appr_guarded", title: "Needs you", detail: "x", status: "pending" },
    ],
    createdAt: messageCreatedAt,
    reactions: [],
  });
  store.pendingApprovals.push({
    id: "appr_guarded",
    conversationId: conversation.id,
    messageId: "msg_guarded_approval",
    botId: bot.id,
    toolName: "run_command",
    args: {},
    createdAt: "2026-09-17T12:46:00.000Z",
    checkpoint: [],
  });
  mocks.state.store = store;
  return { store, bot, conversation };
}

describe("resolveApproval stale approval conditions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeApprovedAction.mockResolvedValue("ok");
  });

  it("executes when the only newer assistant message in the conversation is from another bot", async () => {
    const { store, conversation } = approvalStore();
    store.messages.push({
      id: "msg_newer_other_bot",
      conversationId: conversation.id,
      role: "assistant",
      botId: "bot_forge",
      parts: [{ type: "text", text: "Forge work" }],
      createdAt: "2026-09-17T14:14:00.000Z",
      reactions: [],
    });

    await resolveApproval({ approvalId: "appr_guarded", decision: "approved", emit: vi.fn() });

    expect(mocks.executeApprovedAction).toHaveBeenCalledTimes(1);
  });

  it("executes when the only newer assistant message from the bot is in another conversation", async () => {
    const { store, bot } = approvalStore();
    store.messages.push({
      id: "msg_newer_other_conversation",
      conversationId: "convo_scout",
      role: "assistant",
      botId: bot.id,
      parts: [{ type: "text", text: "Other conversation work" }],
      createdAt: "2026-09-17T14:14:00.000Z",
      reactions: [],
    });

    await resolveApproval({ approvalId: "appr_guarded", decision: "approved", emit: vi.fn() });

    expect(mocks.executeApprovedAction).toHaveBeenCalledTimes(1);
  });

  it("executes when the only newer same-bot message in the conversation is a system message", async () => {
    const { store, bot, conversation } = approvalStore();
    store.messages.push({
      id: "msg_newer_system",
      conversationId: conversation.id,
      role: "system",
      botId: bot.id,
      parts: [{ type: "text", text: "System work" }],
      createdAt: "2026-09-17T14:14:00.000Z",
      reactions: [],
    });

    await resolveApproval({ approvalId: "appr_guarded", decision: "approved", emit: vi.fn() });

    expect(mocks.executeApprovedAction).toHaveBeenCalledTimes(1);
  });

  it("executes when the only other same-bot assistant message predates the approval", async () => {
    const { store, bot, conversation } = approvalStore();
    store.messages.push({
      id: "msg_older_same_bot",
      conversationId: conversation.id,
      role: "assistant",
      botId: bot.id,
      parts: [{ type: "text", text: "Older work" }],
      createdAt: "2026-09-17T10:00:00.000Z",
      reactions: [],
    });

    await resolveApproval({ approvalId: "appr_guarded", decision: "approved", emit: vi.fn() });

    expect(mocks.executeApprovedAction).toHaveBeenCalledTimes(1);
  });

  it("executes when the approval message itself postdates the approval record", async () => {
    approvalStore("2026-09-17T14:14:00.000Z");

    await resolveApproval({ approvalId: "appr_guarded", decision: "approved", emit: vi.fn() });

    expect(mocks.executeApprovedAction).toHaveBeenCalledTimes(1);
  });

  it("denies despite a newer same-bot assistant message without reporting staleness", async () => {
    const { store, bot, conversation } = approvalStore();
    store.messages.push({
      id: "msg_newer_same_bot",
      conversationId: conversation.id,
      role: "assistant",
      botId: bot.id,
      parts: [{ type: "text", text: "Newer work" }],
      createdAt: "2026-09-17T14:14:00.000Z",
      reactions: [],
    });
    const emit = vi.fn();

    await resolveApproval({ approvalId: "appr_guarded", decision: "denied", emit });

    expect(emit.mock.calls.map(([event]) => event)).not.toContainEqual(
      expect.objectContaining({ type: "error", message: expect.stringContaining("out of date") })
    );
    expect(store.messages.find((item) => item.id === "msg_guarded_approval")?.parts[0]).toMatchObject({
      type: "approval",
      status: "denied",
    });
  });
});
