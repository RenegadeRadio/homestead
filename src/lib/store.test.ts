import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("store loading", () => {
  let dataDir: string;

  beforeEach(() => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-store-"));
    process.env.CREW_DATA_DIR = dataDir;
  });

  afterEach(() => {
    delete process.env.CREW_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("creates and persists a seeded store when store.json is missing", async () => {
    const { STORE_PATH } = await import("@/lib/paths");
    const { getStore } = await import("@/lib/store");

    const store = await getStore();

    expect(store.bots.length).toBeGreaterThan(0);
    expect(store.settings.shellPolicy).toBe("ask");
    expect(fs.existsSync(STORE_PATH)).toBe(true);
    expect(JSON.parse(fs.readFileSync(STORE_PATH, "utf8"))).toMatchObject({
      settings: { shellPolicy: "ask" },
    });
  });

  it("preserves invalid JSON under an unreadable filename and reseeds", async () => {
    const { STORE_PATH } = await import("@/lib/paths");
    fs.writeFileSync(STORE_PATH, "{not json", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getStore } = await import("@/lib/store");

    const store = await getStore();
    const unreadableFiles = fs
      .readdirSync(dataDir)
      .filter((name) => name.startsWith("store.json.unreadable-"));

    expect(unreadableFiles).toHaveLength(1);
    expect(
      fs.readFileSync(path.join(dataDir, unreadableFiles[0]), "utf8")
    ).toBe("{not json");
    expect(store.bots.length).toBeGreaterThan(0);
    expect(store.settings.shellPolicy).toBe("ask");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(unreadableFiles[0]));
  });

  it("repairs missing fields without replacing fields that are present", async () => {
    const { STORE_PATH } = await import("@/lib/paths");
    const keptBot = {
      id: "bot_kept",
      name: "Kept",
      job: "Tester",
      instructions: "Keep this bot",
      memory: "",
      emoji: "K",
      color: "#000000",
      providerId: "prov_kept",
      model: "kept-model",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify({ bots: [keptBot] }), "utf8");
    const { getStore } = await import("@/lib/store");

    const store = await getStore();

    expect(store.bots).toEqual([keptBot]);
    expect(store.plugins).toEqual([]);
    expect(store.routines).toEqual([]);
    expect(store.settings.shellPolicy).toBe("ask");
    expect(store.skills.some((skill) => skill.slug === "signed-in-site")).toBe(true);
    expect(fs.existsSync(path.join(store.settings.computerRoot, "README.md"))).toBe(
      true
    );
    expect(
      fs.readdirSync(dataDir).some((name) => name.startsWith("store.json.unreadable-"))
    ).toBe(false);
  });
});
