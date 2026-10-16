import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("search_files output", () => {
  let dataDir: string;
  let computerRoot: string;
  let executeTool: typeof import("@/lib/agent/execute").executeTool;
  let store: Awaited<ReturnType<typeof import("@/lib/store").getStore>>;

  beforeAll(async () => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-search-output-"));
    process.env.CREW_DATA_DIR = dataDir;
    ({ DEFAULT_COMPUTER_ROOT: computerRoot } = await import("@/lib/paths"));
    const storeModule = await import("@/lib/store");
    ({ executeTool } = await import("@/lib/agent/execute"));
    store = await storeModule.getStore();
  });

  afterAll(() => {
    delete process.env.CREW_DATA_DIR;
    globalThis.__crewStore = undefined;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns No matches. when nothing matches", async () => {
    const result = await executeTool(
      "search_files",
      { query: "absent-word" },
      {
        store,
        bot: store.bots[0],
        conversationId: store.conversations[0].id,
        messageId: store.messages[0].id,
      }
    );

    expect(result.result).toBe("No matches.");
  });

  it("truncates at 100 matches and appends the not-shown marker", async () => {
    fs.writeFileSync(
      path.join(computerRoot, "many.txt"),
      `${Array.from({ length: 101 }, (_, index) => `needle line ${index}`).join("\n")}\n`
    );

    const result = await executeTool(
      "search_files",
      { query: "needle" },
      {
        store,
        bot: store.bots[0],
        conversationId: store.conversations[0].id,
        messageId: store.messages[0].id,
      }
    );
    const lines = result.result.split("\n");

    expect(lines).toHaveLength(101);
    expect(lines.slice(0, 100)).toEqual(
      Array.from({ length: 100 }, (_, index) => `many.txt:${index + 1}: needle line ${index}`)
    );
    expect(lines[100]).toBe("(more matches not shown)");
  });
});
