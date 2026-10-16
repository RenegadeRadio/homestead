import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("searchComputerFiles guards", () => {
  let dataDir: string;

  beforeEach(() => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-search-guards-"));
    process.env.CREW_DATA_DIR = dataDir;
  });

  afterEach(() => {
    delete process.env.CREW_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function setup() {
    const { DEFAULT_COMPUTER_ROOT } = await import("@/lib/paths");
    const { getStore } = await import("@/lib/store");
    const { searchComputerFiles } = await import("@/lib/computer");
    await getStore();
    return { root: DEFAULT_COMPUTER_ROOT, searchComputerFiles };
  }

  it("skips files over 1MB", async () => {
    const { root, searchComputerFiles } = await setup();
    fs.writeFileSync(path.join(root, "small.txt"), "needle");
    fs.writeFileSync(path.join(root, "big.txt"), `needle ${"x".repeat(1_100_000)}`);

    const result = await searchComputerFiles("needle");

    expect(result.matches).toEqual([{ path: "small.txt", line: 1, text: "needle" }]);
  });

  it("skips node_modules and .git directories", async () => {
    const { root, searchComputerFiles } = await setup();
    fs.mkdirSync(path.join(root, "node_modules/pkg"), { recursive: true });
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules/pkg/a.txt"), "needle");
    fs.writeFileSync(path.join(root, ".git/b.txt"), "needle");
    fs.writeFileSync(path.join(root, "src/c.txt"), "needle");

    const result = await searchComputerFiles("needle");

    expect(result.matches).toEqual([{ path: "src/c.txt", line: 1, text: "needle" }]);
  });
});
