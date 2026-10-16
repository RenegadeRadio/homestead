import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("persistStore", () => {
  let dataDir: string;

  beforeEach(() => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-persist-"));
    process.env.CREW_DATA_DIR = dataDir;
  });

  afterEach(() => {
    delete process.env.CREW_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("saves the current cached store before its promise settles", async () => {
    const { STORE_PATH } = await import("@/lib/paths");
    const { getStore, persistStore } = await import("@/lib/store");
    const store = await getStore();
    store.settings.shellPolicy = "allow";

    await persistStore();

    expect(JSON.parse(fs.readFileSync(STORE_PATH, "utf8")).settings.shellPolicy).toBe("allow");
  });

  it("shares the updateStore FIFO queue", async () => {
    const { getStore, persistStore, updateStore } = await import("@/lib/store");
    await getStore();
    const order: string[] = [];

    const first = persistStore().then(() => order.push("persist-1"));
    const update = updateStore(() => order.push("update"));
    const second = persistStore().then(() => order.push("persist-2"));
    await Promise.all([first, update, second]);

    expect(order).toEqual(["persist-1", "update", "persist-2"]);
  });
});
