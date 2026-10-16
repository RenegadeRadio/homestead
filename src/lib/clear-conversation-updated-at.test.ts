import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { stopConversation } = vi.hoisted(() => ({ stopConversation: vi.fn() }));

vi.mock("@/lib/agent/run", () => ({ stopConversation }));

describe("clearConversation updatedAt", () => {
  let dataDir: string;

  beforeEach(() => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    stopConversation.mockReset();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-clear-updated-at-"));
    process.env.CREW_DATA_DIR = dataDir;
  });

  afterEach(() => {
    delete process.env.CREW_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("sets the conversation timestamp to the archive clear timestamp", async () => {
    const originalUpdatedAt = "2026-09-16T09:00:00.000Z";
    const { getStore, updateStore } = await import("@/lib/store");
    const { mutate } = await import("@/lib/mutate");

    await updateStore((store) => {
      store.conversations = [
        {
          id: "conversation_one",
          kind: "dm",
          title: "One",
          botIds: ["bot_one"],
          createdAt: originalUpdatedAt,
          updatedAt: originalUpdatedAt,
        },
      ];
    });

    const result = await mutate({ op: "clearConversation", id: "conversation_one" });
    if (!("archivePath" in result)) throw new Error("Missing archive path.");

    const archive = JSON.parse(fs.readFileSync(result.archivePath, "utf8")) as {
      clearedAt: string;
    };
    const store = await getStore();
    const conversation = store.conversations.find((item) => item.id === "conversation_one");

    expect(conversation?.updatedAt).toBe(archive.clearedAt);
    expect(conversation?.updatedAt).not.toBe(originalUpdatedAt);
  });
});
