import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("seed upgrades", () => {
  let dataDir: string;

  beforeEach(() => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-seed-upgrades-"));
    process.env.CREW_DATA_DIR = dataDir;
  });

  afterEach(() => {
    delete process.env.CREW_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function writeStore(skillBody: string) {
    const { createSeedStore } = await import("@/lib/seed");
    const store = createSeedStore();
    store.skills = [
      {
        id: "skill_signed_in",
        name: "Signed-in site",
        slug: "signed-in-site",
        body: skillBody,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    fs.writeFileSync(
      path.join(dataDir, "store.json"),
      JSON.stringify(store),
      "utf8"
    );
  }

  it("upgrades the superseded signed-in-site body", async () => {
    const { SKILL_BODY_UPGRADES } = await import("@/lib/seed-upgrades");
    await writeStore(SKILL_BODY_UPGRADES[0].oldBody);
    const { getStore } = await import("@/lib/store");

    const store = await getStore();

    expect(store.skills[0].body).toBe(SKILL_BODY_UPGRADES[0].newBody());
  });

  it("preserves an operator-edited signed-in-site body", async () => {
    const { SKILL_BODY_UPGRADES } = await import("@/lib/seed-upgrades");
    const editedBody = `${SKILL_BODY_UPGRADES[0].oldBody}\n7. Operator note.`;
    await writeStore(editedBody);
    const { getStore } = await import("@/lib/store");

    const store = await getStore();

    expect(store.skills[0].body).toBe(editedBody);
  });

  it("upgrades the superseded computer README", async () => {
    const { README_UPGRADES } = await import("@/lib/seed-upgrades");
    await writeStore(README_UPGRADES[0].newText);
    const computerRoot = path.join(dataDir, "computer");
    fs.mkdirSync(computerRoot, { recursive: true });
    fs.writeFileSync(
      path.join(computerRoot, "README.md"),
      README_UPGRADES[0].oldText,
      "utf8"
    );
    const { getStore, SEEDED_COMPUTER_README } = await import("@/lib/store");

    await getStore();

    expect(fs.readFileSync(path.join(computerRoot, "README.md"), "utf8")).toBe(
      SEEDED_COMPUTER_README
    );
  });

  it("preserves an operator-edited computer README", async () => {
    const { README_UPGRADES } = await import("@/lib/seed-upgrades");
    await writeStore(README_UPGRADES[0].newText);
    const computerRoot = path.join(dataDir, "computer");
    fs.mkdirSync(computerRoot, { recursive: true });
    const editedText = `${README_UPGRADES[0].oldText}\nMy own notes.`;
    fs.writeFileSync(path.join(computerRoot, "README.md"), editedText, "utf8");
    const { getStore } = await import("@/lib/store");

    await getStore();

    expect(fs.readFileSync(path.join(computerRoot, "README.md"), "utf8")).toBe(
      editedText
    );
  });

  it("records the superseded em-dash text", async () => {
    const { README_UPGRADES, SKILL_BODY_UPGRADES } = await import(
      "@/lib/seed-upgrades"
    );

    expect(SKILL_BODY_UPGRADES[0].oldBody).toContain("\u2014");
    expect(README_UPGRADES[0].oldText).toContain("\u2014");
  });
});
