import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("company candidates store repair", () => {
  let dataDir: string;

  beforeEach(() => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-company-store-"));
    process.env.CREW_DATA_DIR = dataDir;
  });

  afterEach(() => {
    delete process.env.CREW_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("repairs a missing companyCandidates field", async () => {
    const { STORE_PATH } = await import("@/lib/paths");
    fs.writeFileSync(STORE_PATH, JSON.stringify({ bots: [] }), "utf8");
    const { getStore } = await import("@/lib/store");

    const store = await getStore();

    expect(store.companyCandidates).toEqual([]);
  });
});
