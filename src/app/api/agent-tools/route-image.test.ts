import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/execute", () => ({ executeTool: vi.fn() }));

import { executeTool } from "@/lib/agent/execute";
import { registerTurn, unregisterTurn } from "@/lib/agent/claude-code";
import { POST } from "@/app/api/agent-tools/route";
import { createSeedStore } from "@/lib/seed";

const token = "route-image-token";

afterEach(() => unregisterTurn(token));

describe("POST /api/agent-tools image result", () => {
  it("returns an image beside the text result", async () => {
    const store = createSeedStore();
    registerTurn(token, {
      store,
      bot: store.bots[0],
      conversationId: store.conversations[0].id,
      messageId: store.messages[0].id,
      emit: vi.fn(),
      sessionId: "route-image-session",
    });
    vi.mocked(executeTool).mockResolvedValue({
      result: "text",
      image: { data: "abc", mimeType: "image/jpeg" },
    });
    const request = new Request("http://127.0.0.1:43177/api/agent-tools", {
      method: "POST",
      headers: {
        host: "127.0.0.1:43177",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "browser_screenshot", arguments: {} }),
    });

    const response = await POST(request);

    await expect(response.json()).resolves.toEqual({
      result: "text",
      image: { data: "abc", mimeType: "image/jpeg" },
    });
  });
});
