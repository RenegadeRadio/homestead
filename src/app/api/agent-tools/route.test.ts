import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/execute", () => ({ executeTool: vi.fn() }));

import { executeTool } from "@/lib/agent/execute";
import { registerTurn, unregisterTurn } from "@/lib/agent/claude-code";
import { PAUSED_TEXT, POST } from "@/app/api/agent-tools/route";
import { createSeedStore } from "@/lib/seed";
import type { PendingApproval } from "@/lib/types";

const registeredTokens = new Set<string>();

function makeRequest(body: unknown, token?: string) {
  return new Request("http://127.0.0.1:43177/api/agent-tools", {
    method: "POST",
    headers: {
      host: "127.0.0.1:43177",
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function register(token: string, sessionId: string, messageId: string) {
  const store = createSeedStore();
  const bot = store.bots[0];
  const conversation = store.conversations[0];
  registeredTokens.add(token);
  registerTurn(token, {
    store,
    bot,
    conversationId: conversation.id,
    messageId,
    emit: vi.fn(),
    sessionId,
  });
  return { store, bot, conversation };
}

beforeEach(() => {
  vi.mocked(executeTool).mockReset();
});

afterEach(() => {
  for (const token of registeredTokens) unregisterTurn(token);
  registeredTokens.clear();
});

describe("POST /api/agent-tools", () => {
  it.each([
    ["a missing token", undefined],
    ["an unknown token", "not-registered"],
  ])("refuses %s", async (_label, token) => {
    const response = await POST(makeRequest({ name: "list_files", arguments: {} }, token));
    expect(response.status).toBe(403);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("refuses an unknown token while another turn is registered", async () => {
    register("tok-real", "sess-3", "msg_z");

    const response = await POST(
      makeRequest({ name: "list_files", arguments: {} }, "tok-imposter")
    );

    expect(response.status).toBe(403);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("runs a tool with the registered turn context", async () => {
    const { store, bot, conversation } = register("tok-valid", "sess-1", "msg_x");
    vi.mocked(executeTool).mockResolvedValue({ result: "listed files" });

    const response = await POST(
      makeRequest({ name: "list_files", arguments: { path: "." } }, "tok-valid")
    );

    expect(executeTool).toHaveBeenCalledWith(
      "list_files",
      { path: "." },
      { store, bot, conversationId: conversation.id, messageId: "msg_x" }
    );
    await expect(response.json()).resolves.toMatchObject({ result: "listed files" });
  });

  it("stores the session id on an approval and pauses later tool calls", async () => {
    const { store, bot, conversation } = register("tok-pause", "sess-2", "msg_y");
    store.messages.push({
      id: "msg_y",
      conversationId: conversation.id,
      role: "assistant",
      botId: bot.id,
      parts: [],
      createdAt: "2026-09-16T00:00:00.000Z",
      reactions: [],
    });
    const approval: PendingApproval = {
      id: "appr_pause",
      conversationId: conversation.id,
      messageId: "msg_y",
      botId: bot.id,
      toolName: "run_command",
      args: { command: "rm -rf /" },
      createdAt: "2026-09-16T00:00:00.000Z",
      checkpoint: [],
      kind: "shell",
    };
    vi.mocked(executeTool).mockResolvedValueOnce({ result: "needs approval", approval });

    await POST(
      makeRequest(
        { name: "run_command", arguments: { command: "rm -rf /" } },
        "tok-pause"
      )
    );
    expect(store.pendingApprovals.at(-1)?.resumeSessionId).toBe("sess-2");

    const response = await POST(
      makeRequest({ name: "list_files", arguments: { path: "." } }, "tok-pause")
    );
    await expect(response.json()).resolves.toMatchObject({ result: PAUSED_TEXT });
    expect(executeTool).toHaveBeenCalledTimes(1);
  });
});
