import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOOL_DEFINITIONS } from "@/lib/agent/tools";
import { handleMessage } from "./crew-mcp.mjs";

const envNames = ["CREW_TOOLS", "CREW_BRIDGE_URL", "CREW_TURN_TOKEN"] as const;
let previousEnv: Record<(typeof envNames)[number], string | undefined>;

beforeEach(() => {
  previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]])) as typeof previousEnv;
  process.env.CREW_TOOLS = JSON.stringify(
    TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
    }))
  );
  process.env.CREW_BRIDGE_URL = "http://127.0.0.1:43177/api/agent-tools";
  process.env.CREW_TURN_TOKEN = "turn-token";
});

afterEach(() => {
  for (const name of envNames) {
    const value = previousEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("crew MCP server", () => {
  it("lists every Homestead tool", async () => {
    const reply = await handleMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      vi.fn()
    );
    if (!reply || !("result" in reply)) throw new Error("Expected a tools/list result");
    const result = reply.result as { tools: { name: string }[] };

    expect(result.tools.map((tool) => tool.name).sort()).toEqual(
      TOOL_DEFINITIONS.map((tool) => tool.name).sort()
    );
  });

  it("forwards tool calls to the authenticated bridge", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "42" }),
      text: async () => "",
    });

    const reply = await handleMessage(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "list_files", arguments: { path: "." } },
      },
      fetchFn
    );
    if (!reply || !("result" in reply)) throw new Error("Expected a tools/call result");
    const result = reply.result as { content: { text: string }[] };

    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:43177/api/agent-tools",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer turn-token" }),
      })
    );
    expect(result.content[0].text).toBe("42");
  });
});
