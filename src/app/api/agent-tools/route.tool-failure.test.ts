import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/execute", () => ({ executeTool: vi.fn() }));

import { POST } from "@/app/api/agent-tools/route";
import { registerTurn, unregisterTurn } from "@/lib/agent/claude-code";
import { executeTool } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";

const token = "tok-tool-failure";

beforeEach(() => {
  vi.mocked(executeTool).mockReset();
});

afterEach(() => {
  unregisterTurn(token);
});

describe("POST /api/agent-tools tool failures", () => {
  it("ends the tool card and returns the failure to the model", async () => {
    const store = createSeedStore();
    const bot = store.bots[0];
    const conversation = store.conversations[0];
    const emit = vi.fn();
    registerTurn(token, {
      store,
      bot,
      conversationId: conversation.id,
      messageId: "msg_tool_failure",
      emit,
      sessionId: "sess-tool-failure",
    });
    vi.mocked(executeTool).mockRejectedValueOnce(new Error("socket hang up"));

    const response = await POST(
      new Request("http://127.0.0.1:43177/api/agent-tools", {
        method: "POST",
        headers: {
          host: "127.0.0.1:43177",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "browse_url", arguments: { url: "https://example.com" } }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ result: "Tool failed: socket hang up" });
    const start = emit.mock.calls[0][0];
    expect(start).toMatchObject({ type: "tool_start", name: "browse_url" });
    expect(emit.mock.calls[1][0]).toEqual({
      type: "tool_end",
      botId: bot.id,
      messageId: "msg_tool_failure",
      toolId: start.toolId,
      result: "Tool failed: socket hang up",
      status: "error",
    });
  });
});
