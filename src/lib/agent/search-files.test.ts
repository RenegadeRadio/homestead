import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("search_files tool", () => {
  let dataDir: string;

  beforeEach(() => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-search-tool-"));
    process.env.CREW_DATA_DIR = dataDir;
  });

  afterEach(() => {
    delete process.env.CREW_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("executes without approval and records a file log", async () => {
    const { DEFAULT_COMPUTER_ROOT } = await import("@/lib/paths");
    const { getStore } = await import("@/lib/store");
    const { executeTool } = await import("@/lib/agent/execute");
    const store = await getStore();
    fs.mkdirSync(path.join(DEFAULT_COMPUTER_ROOT, "research"), { recursive: true });
    fs.writeFileSync(path.join(DEFAULT_COMPUTER_ROOT, "research/a.md"), "one\ntwo\ntelli GmbH\n");
    const result = await executeTool(
      "search_files",
      { query: "telli" },
      {
        store,
        bot: store.bots[0],
        conversationId: store.conversations[0].id,
        messageId: store.messages[0].id,
      }
    );

    expect(result.result).toContain("research/a.md:3: telli GmbH");
    expect(result.approval).toBeUndefined();
    expect(store.computerLogs).toContainEqual(
      expect.objectContaining({ kind: "file", summary: 'Searched files for "telli"' })
    );
  });

  it("is defined with only query required and is included in the prompt", async () => {
    const { TOOL_DEFINITIONS } = await import("@/lib/agent/tools");
    const { buildSystemPrompt } = await import("@/lib/agent/prompt");
    const { createSeedStore } = await import("@/lib/seed");
    const tool = TOOL_DEFINITIONS.find((definition) => definition.name === "search_files");
    const store = createSeedStore();

    expect(tool?.parameters.required).toEqual(["query"]);
    expect(buildSystemPrompt(store.bots[0], store)).toContain(
      "use search_files, not run_command"
    );
  });
});
