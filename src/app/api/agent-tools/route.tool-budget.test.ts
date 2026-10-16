import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/execute", () => ({ executeTool: vi.fn() }));

import { POST } from "@/app/api/agent-tools/route";
import { registerTurn, unregisterTurn } from "@/lib/agent/claude-code";
import { executeTool } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";
import { toolBudgetText } from "@/lib/agent/tool-budget";

const registeredTokens = new Set<string>();

function makeRequest(token: string) {
  return new Request("http://127.0.0.1:43177/api/agent-tools", {
    method: "POST",
    headers: {
      host: "127.0.0.1:43177",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name: "list_files", arguments: { path: "." } }),
  });
}

function register(token: string, budget?: number) {
  const store = createSeedStore();
  if (budget !== undefined) store.settings.toolBudgetPerTurn = budget;
  const bot = store.bots[0];
  const conversation = store.conversations[0];
  registeredTokens.add(token);
  registerTurn(token, {
    store,
    bot,
    conversationId: conversation.id,
    messageId: `msg_${token}`,
    emit: vi.fn(),
    sessionId: `session_${token}`,
  });
  return store;
}

async function callTool(token: string) {
  const response = await POST(makeRequest(token));
  return response.json() as Promise<{ result: string }>;
}

beforeEach(() => {
  vi.mocked(executeTool).mockReset().mockResolvedValue({ result: "ok" });
});

afterEach(() => {
  for (const token of registeredTokens) unregisterTurn(token);
  registeredTokens.clear();
});

describe("Claude Code turn tool budgets", () => {
  it("executes only the configured number of tool calls", async () => {
    register("budget-three", 3);

    const results = [];
    for (let index = 0; index < 4; index += 1) results.push(await callTool("budget-three"));

    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(results[3].result).toBe(toolBudgetText(3));
  });

  it("logs an exceeded budget only once per turn", async () => {
    const store = register("budget-log", 3);

    for (let index = 0; index < 5; index += 1) await callTool("budget-log");

    expect(
      store.computerLogs.filter((log) => log.summary.startsWith("Tool budget reached:"))
    ).toHaveLength(1);
  });

  it("defaults to forty tool calls", async () => {
    register("budget-default");

    let result = { result: "" };
    for (let index = 0; index < 41; index += 1) result = await callTool("budget-default");

    expect(executeTool).toHaveBeenCalledTimes(40);
    expect(result.result).toMatch(/^Tool budget reached \(40 calls this turn\)/);
  });
});
