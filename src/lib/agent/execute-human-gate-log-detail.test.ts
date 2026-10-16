import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserNavigate: vi.fn(),
    setBrowserMode: vi.fn(),
  };
});

import { executeTool, type ToolContext } from "@/lib/agent/execute";
import { browserNavigate } from "@/lib/browser";
import { createSeedStore } from "@/lib/seed";

describe("executeTool human gate detail logging", () => {
  it("adds CAPTCHA frame details to the browser navigation gate log", async () => {
    const store = createSeedStore();
    const ctx: ToolContext = {
      store,
      bot: store.bots[0],
      conversationId: store.conversations[0].id,
      messageId: store.messages[0].id,
    };
    vi.mocked(browserNavigate).mockResolvedValue({
      url: "https://x",
      title: "x",
      snapshot: "",
      gate: {
        needed: true,
        reason: "This page is asking for a CAPTCHA or human check.",
        signal: "captcha frame",
        detail: "www.google.com 304x78",
      },
    });

    await executeTool("browser_navigate", { url: "https://x" }, ctx);

    expect(
      ctx.store.computerLogs.some(
        (entry) =>
          entry.kind === "browser" &&
          entry.summary === "Human gate: captcha frame (www.google.com 304x78)"
      )
    ).toBe(true);
  });
});
