import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserSnapshot: vi.fn(),
    browserType: vi.fn(),
  };
});

vi.mock("@/lib/computer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/computer")>();
  return {
    ...actual,
    resolveInComputer: vi.fn(async (rel: string) => ({
      root: "/computer",
      target: `/computer/${rel}`,
      rel: rel.replace(/^\.\//, "").replaceAll("\\", "/"),
    })),
    writeComputerFile: vi.fn(async (rel: string) => ({ path: rel, action: "created" as const })),
  };
});

import { executeTool, type ToolContext } from "@/lib/agent/execute";
import { browserSnapshot, browserType } from "@/lib/browser";
import { writeComputerFile } from "@/lib/computer";
import { createSeedStore } from "@/lib/seed";

describe("client-facing draft checks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses browser text with an em dash before browser work or approval", async () => {
    const result = await executeTool("browser_type", { text: "Hello — there", ref: 4 }, context());

    expect(result.result).toBe(
      "Draft check failed: contains an em dash (U+2014). Rewrite the text without them and try again."
    );
    expect(result.approval).toBeUndefined();
    expect(browserType).not.toHaveBeenCalled();
    expect(browserSnapshot).not.toHaveBeenCalled();
  });

  it("checks writes under drafts but not elsewhere", async () => {
    const ctx = context();
    const content = "Let us delve into this.";

    const refused = await executeTool(
      "write_file",
      { path: "drafts/note.md", content },
      ctx
    );
    expect(refused.result).toBe(
      'Draft check failed: contains the phrase "delve". Rewrite the text without them and try again.'
    );
    expect(writeComputerFile).not.toHaveBeenCalled();

    const written = await executeTool(
      "write_file",
      { path: "research/note.md", content },
      ctx
    );
    expect(written.result).toBe("created research/note.md (23 chars)");
    expect(writeComputerFile).toHaveBeenCalledWith("research/note.md", content);
  });

  it("uses the operator phrase list instead of the default list for draft writes", async () => {
    const ctx = context(["circle back"]);
    const content = "Let us delve into this.";

    const written = await executeTool(
      "write_file",
      { path: "drafts/note.md", content },
      ctx
    );

    expect(written.result).toBe("created drafts/note.md (23 chars)");
    expect(writeComputerFile).toHaveBeenCalledWith("drafts/note.md", content);
  });

  it("refuses draft writes containing an operator phrase", async () => {
    const ctx = context(["circle back"]);

    const refused = await executeTool(
      "write_file",
      { path: "drafts/note.md", content: "Circle back with them next week." },
      ctx
    );

    expect(refused.result).toBe(
      'Draft check failed: contains the phrase "circle back". Rewrite the text without them and try again.'
    );
    expect(writeComputerFile).not.toHaveBeenCalled();
  });
});

function context(draftBannedPhrases?: string[]): ToolContext {
  const store = createSeedStore();
  if (draftBannedPhrases) store.settings.draftBannedPhrases = draftBannedPhrases;
  return {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
  };
}
