import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("seed upgrades (pinning)", () => {
  let dataDir: string;

  beforeEach(() => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-seed-upgrades-pin-"));
    process.env.CREW_DATA_DIR = dataDir;
  });

  afterEach(() => {
    delete process.env.CREW_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function writeStoreWithSkill(slug: string, body: string) {
    const { createSeedStore } = await import("@/lib/seed");
    const store = createSeedStore();
    store.skills = [
      {
        id: `skill_${slug}`,
        name: "Test skill",
        slug,
        body,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    fs.writeFileSync(
      path.join(dataDir, "store.json"),
      JSON.stringify(store),
      "utf8"
    );
  }

  it("upgrades signed-in-site to the current seeded body", async () => {
    const { SKILL_BODY_UPGRADES } = await import("@/lib/seed-upgrades");
    const { createSeedStore } = await import("@/lib/seed");
    await writeStoreWithSkill(
      "signed-in-site",
      SKILL_BODY_UPGRADES[0].oldBody
    );
    const { getStore } = await import("@/lib/store");

    const store = await getStore();
    const expectedBody = createSeedStore().skills.find(
      (skill) => skill.slug === "signed-in-site"
    )!.body;
    const actualBody = store.skills.find(
      (skill) => skill.slug === "signed-in-site"
    )!.body;

    expect(actualBody).toBe(expectedBody);
    expect(actualBody).toContain(
      "6. If the site blocks automation, stop and say so. Do not try to hide that you are a Bot."
    );
  });

  it("does not upgrade a different skill with the superseded body", async () => {
    const { SKILL_BODY_UPGRADES } = await import("@/lib/seed-upgrades");
    await writeStoreWithSkill("my-copy", SKILL_BODY_UPGRADES[0].oldBody);
    const { getStore } = await import("@/lib/store");

    const store = await getStore();

    expect(store.skills.find((skill) => skill.slug === "my-copy")!.body).toBe(
      SKILL_BODY_UPGRADES[0].oldBody
    );
  });
});
