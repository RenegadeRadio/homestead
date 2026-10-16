import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import { runClaudeCodeTurn } from "@/lib/agent/claude-code";
import { createSeedStore } from "@/lib/seed";

function createFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  setImmediate(() => {
    child.stdout.emit("data", JSON.stringify({ result: "done", session_id: "sess-x" }));
    child.emit("close", 0);
  });
  return child;
}

describe("runClaudeCodeTurn cleanup", () => {
  it("preserves a completed tool's status and result when the turn ends", async () => {
    const store = createSeedStore();
    const bot = store.bots.find((item) => item.id === "bot_scout")!;
    const provider = store.providers.find((item) => item.id === bot.providerId)!;
    const conversation = store.conversations.find((item) => item.botIds.includes(bot.id))!;
    store.messages.push({
      id: "msg_completed_tool",
      conversationId: conversation.id,
      role: "assistant",
      botId: bot.id,
      parts: [
        { type: "tool", id: "tool_done", name: "browse_url", args: {}, status: "done", result: "ok" },
      ],
      createdAt: "2026-09-17T12:00:00.000Z",
      reactions: [],
    });

    await runClaudeCodeTurn({
      store,
      bot,
      provider,
      conversationId: conversation.id,
      messageId: "msg_completed_tool",
      prompt: "go",
      emit: vi.fn(),
      signal: new AbortController().signal,
      spawnFn: (() => createFakeChild()) as unknown as typeof spawn,
    });

    const message = store.messages.find((item) => item.id === "msg_completed_tool")!;
    expect(message.parts[0]).toMatchObject({
      type: "tool",
      status: "done",
      result: "ok",
    });
  });
});
