import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runClaudeCodeTurn } from "@/lib/agent/claude-code";
import { createSeedStore } from "@/lib/seed";

const stdinWarning = "Warning: no stdin data received in 3s, proceeding without it.";

function createFakeChild(opts: { stderr: string; exitCode: number | null; closeOnKill?: boolean }) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => {
    if (opts.closeOnKill) {
      child.stderr.emit("data", opts.stderr);
      child.emit("close", null);
    }
  });
  if (!opts.closeOnKill) {
    setImmediate(() => {
      child.stderr.emit("data", opts.stderr);
      child.emit("close", opts.exitCode);
    });
  }
  return child;
}

function runWithChild(child: ReturnType<typeof createFakeChild>) {
  const store = createSeedStore();
  const bot = store.bots.find((item) => item.id === "bot_scout")!;
  const provider = store.providers.find((item) => item.id === bot.providerId)!;
  const conversation = store.conversations.find((item) => item.botIds.includes(bot.id))!;
  const messageId = `msg_claude_code_${Math.random()}`;
  store.messages.push({
    id: messageId,
    conversationId: conversation.id,
    role: "assistant",
    botId: bot.id,
    parts: [],
    createdAt: "2026-10-10T00:00:00.000Z",
    reactions: [],
  });

  return runClaudeCodeTurn({
    store,
    bot,
    provider,
    conversationId: conversation.id,
    messageId,
    prompt: "go",
    emit: vi.fn(),
    signal: new AbortController().signal,
    spawnFn: (() => child) as unknown as typeof spawn,
  });
}

async function getError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the turn to reject.");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runClaudeCodeTurn failures", () => {
  it("reports the time limit when the deadline kills the child", async () => {
    vi.useFakeTimers();
    const child = createFakeChild({ stderr: stdinWarning, exitCode: null, closeOnKill: true });
    const turn = runWithChild(child);
    const errorPromise = getError(turn);

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);
    const error = await errorPromise;

    expect(error.message).toContain("10 minutes (time limit)");
    expect(error.message).not.toContain("stdin");
  });

  it("removes the stdin warning but preserves other stderr", async () => {
    const child = createFakeChild({ stderr: `${stdinWarning}\nboom`, exitCode: 2 });
    const error = await getError(runWithChild(child));

    expect(error.message).toMatch(/^Claude Code turn failed:/);
    expect(error.message).toContain("boom");
    expect(error.message).not.toContain("stdin");
  });

  it("uses the fallback when stderr contains only the stdin warning", async () => {
    const child = createFakeChild({ stderr: stdinWarning, exitCode: 1 });
    const error = await getError(runWithChild(child));

    expect(error.message).toBe("Claude Code turn failed: Claude Code failed.");
  });
});
