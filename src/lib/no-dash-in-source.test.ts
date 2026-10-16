import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "@/lib/agent/prompt";
import { createSeedStore } from "@/lib/seed";

const libDirectory = path.resolve(process.cwd(), "src/lib");
const forbiddenDashes = /[\u2013\u2014]/;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
    })
  );

  return nestedFiles
    .flat()
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
}

describe("model-facing text", () => {
  it("has no literal em or en dashes in non-test TypeScript sources", async () => {
    const offenders: string[] = [];

    for (const file of await sourceFiles(libDirectory)) {
      const contents = await readFile(file, "utf8");
      contents.split("\n").forEach((line, index) => {
        if (forbiddenDashes.test(line)) {
          offenders.push(`${path.relative(process.cwd(), file)}:${index + 1}`);
        }
      });
    }

    expect(offenders, `Forbidden dash characters found in:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("builds the seed prompt without forbidden dashes and uses colon skill labels", () => {
    const store = createSeedStore();
    const prompt = buildSystemPrompt(store.bots[0], store);

    expect(prompt).not.toMatch(forbiddenDashes);
    for (const skill of store.skills) {
      expect(prompt).toContain(`/${skill.slug}: ${skill.name}`);
    }
  });
});
