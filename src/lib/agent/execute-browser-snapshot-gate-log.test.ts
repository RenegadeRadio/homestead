import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserSnapshot: vi.fn(),
    setBrowserMode: vi.fn(),
  };
});

import { browserSnapshot } from "@/lib/browser";
import { executeTool, type ToolContext } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";

describe("executeTool browser snapshot human gate logging", () => {
  it("logs the gate signal when a browser snapshot pauses", async () => {
    const store = createSeedStore();
    const ctx: ToolContext = {
      store,
      bot: store.bots[0],
      conversationId: store.conversations[0].id,
      messageId: store.messages[0].id,
    };
    vi.mocked(browserSnapshot).mockResolvedValueOnce({
      url: "https://x",
      title: "x",
      snapshot: "",
      gate: {
        needed: true,
        reason: "This page is asking for a CAPTCHA or human check.",
        signal: "captcha title",
      },
    });

    await executeTool("browser_snapshot", {}, ctx);

    expect(
      ctx.store.computerLogs.some(
        (entry) => entry.kind === "browser" && entry.summary === "Human gate: captcha title"
      )
    ).toBe(true);
  });
});
