import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserLook: vi.fn(),
    setBrowserMode: vi.fn(),
  };
});

import { browserLook, setBrowserMode } from "@/lib/browser";
import { executeTool, type ToolContext } from "@/lib/agent/execute";
import { TOOL_DEFINITIONS } from "@/lib/agent/tools";
import { createSeedStore } from "@/lib/seed";

function context(): ToolContext {
  const store = createSeedStore();
  return {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("browser_screenshot", () => {
  it("is included in the tool definitions", () => {
    expect(TOOL_DEFINITIONS.some((tool) => tool.name === "browser_screenshot")).toBe(true);
  });

  it("returns the legend and JPEG image", async () => {
    vi.mocked(browserLook).mockResolvedValue({
      url: "https://example.com/profile",
      title: "Profile",
      gate: { needed: false, reason: "" },
      legend: '[31] a “Message” at (157,536)',
      image: "base64-image",
    });

    const outcome = await executeTool("browser_screenshot", {}, context());

    expect(outcome.result).toContain('[31] a “Message” at (157,536)');
    expect(outcome.image).toEqual({ data: "base64-image", mimeType: "image/jpeg" });
  });

  it("pauses for takeover without returning an image at a human gate", async () => {
    vi.mocked(browserLook).mockResolvedValue({
      url: "https://example.com/challenge",
      title: "Challenge",
      gate: { needed: true, reason: "Complete the CAPTCHA.", signal: "captcha title" },
      legend: "(none visible)",
      image: "unused-image",
    });
    const ctx = context();

    const outcome = await executeTool("browser_screenshot", {}, ctx);

    expect(outcome.image).toBeUndefined();
    expect(outcome.approval?.kind).toBe("takeover");
    expect(setBrowserMode).toHaveBeenCalledWith("human", "Complete the CAPTCHA.");
  });
});
