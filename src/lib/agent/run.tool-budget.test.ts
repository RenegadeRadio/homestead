import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providers = vi.hoisted(() => ({ openaiComplete: vi.fn(), anthropicComplete: vi.fn() }));
const execute = vi.hoisted(() => ({
  executeTool: vi.fn(),
  executeApprovedAction: vi.fn(),
}));
vi.mock("@/lib/agent/providers", () => providers);
vi.mock("@/lib/agent/execute", () => execute);

import { toolBudgetText } from "@/lib/agent/tool-budget";

describe("provider turn tool budgets", () => {
  let dataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    vi.clearAllMocks();
    execute.executeTool.mockResolvedValue({ result: "ok" });
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-run-tool-budget-"));
    process.env.CREW_DATA_DIR = dataDir;
    const { STORE_PATH } = await import("@/lib/paths");
    const { createSeedStore } = await import("@/lib/seed");
    const store = createSeedStore();
    const provider = store.providers.find((item) => item.id === "prov_openai")!;
    provider.apiKey = "key";
    store.bots.find((item) => item.id === "bot_atlas")!.providerId = provider.id;
    store.settings.toolBudgetPerTurn = 2;
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  });

  afterEach(() => {
    delete process.env.CREW_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns an over-budget tool result to the provider", async () => {
    providers.openaiComplete
      .mockResolvedValueOnce({
        content: "",
        tool_calls: [
          { id: "tool_1", name: "list_files", arguments: {} },
          { id: "tool_2", name: "list_files", arguments: {} },
          { id: "tool_3", name: "list_files", arguments: {} },
        ],
      })
      .mockResolvedValueOnce({ content: "done", tool_calls: [] });
    const { handleUserMessage } = await import("@/lib/agent/run");

    await handleUserMessage({ conversationId: "convo_atlas", text: "go", emit: vi.fn() });

    expect(execute.executeTool).toHaveBeenCalledTimes(2);
    const secondRoundMessages = providers.openaiComplete.mock.calls[1][0].messages;
    const overBudgetMessage = secondRoundMessages.find(
      (message: { role: string; tool_call_id?: string }) =>
        message.role === "tool" && message.tool_call_id === "tool_3"
    );
    expect(overBudgetMessage?.content.startsWith(toolBudgetText(2))).toBe(true);
  });
});
