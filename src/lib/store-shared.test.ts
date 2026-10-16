import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("store module copies", () => {
  let dataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "crew-store-shared-"));
    process.env.CREW_DATA_DIR = dataDir;
  });

  afterEach(async () => {
    delete process.env.CREW_DATA_DIR;
    globalThis.__crewStore = undefined;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("shares cached changes between separately imported copies", async () => {
    const first = await import("@/lib/store");
    vi.resetModules();
    const second = await import("@/lib/store");

    expect(first).not.toBe(second);

    await first.updateStore((store) => {
      store.settings.standingRules = "written by first";
    });
    expect((await second.getStore()).settings.standingRules).toBe(
      "written by first"
    );

    await second.updateStore((store) => {
      store.settings.linkedinHold = "written by second";
    });
    await first.updateStore((store) => {
      store.settings.shellPolicy = "allow";
    });

    expect((await first.getStore()).settings.linkedinHold).toBe(
      "written by second"
    );
  });

  it("persists changes made through both module copies", async () => {
    const first = await import("@/lib/store");
    vi.resetModules();
    const second = await import("@/lib/store");

    await first.updateStore((store) => {
      store.settings.standingRules = "written by first";
    });
    await second.updateStore((store) => {
      store.settings.linkedinHold = "written by second";
    });

    const persisted = JSON.parse(
      await fs.readFile(path.join(dataDir, "store.json"), "utf8")
    );
    expect(persisted.settings.standingRules).toBe("written by first");
    expect(persisted.settings.linkedinHold).toBe("written by second");
  });
});
