import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("searchComputerFiles", () => {
  let dataDir: string;

  beforeEach(() => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-search-"));
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

  it("finds literal text with relative path and line details", async () => {
    const { root, searchComputerFiles } = await setup();
    fs.mkdirSync(path.join(root, "research"), { recursive: true });
    fs.writeFileSync(path.join(root, "research/a.md"), "one\ntwo\ntelli GmbH\n");

    await expect(searchComputerFiles("telli")).resolves.toMatchObject({
      matches: [{ path: "research/a.md", line: 3, text: "telli GmbH" }],
      truncated: false,
    });
  });

  it("supports case-insensitive regular expressions and rejects invalid patterns", async () => {
    const { root, searchComputerFiles } = await setup();
    fs.writeFileSync(path.join(root, "companies.txt"), "Auxilliary Plumbers\nAccidentGuru\n");

    const result = await searchComputerFiles("auxil+iary|accidentguru", {
      regex: true,
      ignoreCase: true,
    });
    expect(result.matches.map((match) => match.text)).toEqual([
      "Auxilliary Plumbers",
      "AccidentGuru",
    ]);
    await expect(searchComputerFiles("(", { regex: true })).rejects.toThrow(
      "Invalid search pattern."
    );
  });

  it("rejects outside paths and does not follow symbolic links", async () => {
    const { root, searchComputerFiles } = await setup();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "crew-search-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "hidden needle");
    fs.symlinkSync(outside, path.join(root, "outside"));

    await expect(searchComputerFiles("x", { path: "../" })).rejects.toThrow(
      "Path is outside the shared computer."
    );
    await expect(searchComputerFiles("needle")).resolves.toMatchObject({ matches: [] });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("skips binary files and reports truncation after the match limit", async () => {
    const { root, searchComputerFiles } = await setup();
    fs.writeFileSync(path.join(root, "binary.dat"), Buffer.from("\0needle"));
    fs.writeFileSync(path.join(root, "many.txt"), "needle one\nneedle two\nneedle three\n");

    const result = await searchComputerFiles("needle", { maxMatches: 2 });
    expect(result.matches).toHaveLength(2);
    expect(result.matches.every((match) => match.path === "many.txt")).toBe(true);
    expect(result.truncated).toBe(true);
  });
});
