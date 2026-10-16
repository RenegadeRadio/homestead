import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("store repair gaps", () => {
  let dataDir: string;

  beforeEach(() => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-store-repair-"));
    process.env.CREW_DATA_DIR = dataDir;
  });

  afterEach(async () => {
    const { STORE_PATH } = await import("@/lib/paths");
    try {
      fs.chmodSync(STORE_PATH, 0o600);
    } catch {
      // The store may not exist if a test failed before writing it.
    }
    delete process.env.CREW_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("replaces non-array list fields while preserving array fields", async () => {
    const { STORE_PATH } = await import("@/lib/paths");
    fs.writeFileSync(
      STORE_PATH,
      JSON.stringify({ bots: [], skills: null, routines: "x" }),
      "utf8"
    );
    const { getStore } = await import("@/lib/store");

    const store = await getStore();

    expect(store.routines).toEqual([]);
    expect(store.skills.map((skill) => skill.slug)).toEqual(["signed-in-site"]);
  });

  it("rethrows read errors without overwriting the store", async () => {
    const { STORE_PATH } = await import("@/lib/paths");
    const original = JSON.stringify({ bots: [] });
    fs.writeFileSync(STORE_PATH, original, "utf8");
    fs.chmodSync(STORE_PATH, 0o200);
    const { getStore } = await import("@/lib/store");

    await expect(getStore()).rejects.toMatchObject({ code: "EACCES" });

    fs.chmodSync(STORE_PATH, 0o600);
    expect(fs.readFileSync(STORE_PATH, "utf8")).toBe(original);
    expect(
      fs
        .readdirSync(dataDir)
        .some((name) => name.startsWith("store.json.unreadable-"))
    ).toBe(false);
  });
});
