import { describe, expect, it, vi } from "vitest";

import { handleMessage } from "./crew-mcp.mjs";

describe("crew MCP image content", () => {
  it("appends the bridge image after the text item", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: "42",
        image: { data: "b64", mimeType: "image/jpeg" },
      }),
      text: async () => "",
    });

    const reply = await handleMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: {} },
      fetchFn
    );
    if (!reply || !("result" in reply) || !reply.result) {
      throw new Error("Expected a tools/call result");
    }

    expect(reply.result.content).toEqual([
      { type: "text", text: "42" },
      { type: "image", data: "b64", mimeType: "image/jpeg" },
    ]);
  });
});
