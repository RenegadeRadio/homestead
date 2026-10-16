import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserSnapshot: vi.fn(),
    browserClick: vi.fn(),
    browserComposeText: vi.fn(),
    looksLikeSend: actual.looksLikeSend,
  };
});

import { browserClick, browserSnapshot } from "@/lib/browser";
import { executeTool, type ToolContext } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";

const logPrefix = "Refused LinkedIn send click outside the Outbox:";

function snapshot(line: string) {
  return {
    url: "https://www.linkedin.com/in/konrad-zuse/",
    title: "LinkedIn",
    snapshot: line,
    gate: { needed: false, reason: "" },
  };
}

function context(): ToolContext {
  const store = createSeedStore();
  store.settings.linkedinActionGapMinSeconds = 0;
  store.settings.linkedinActionGapMaxSeconds = 0;
  store.settings.linkedinSendWindowEnd = store.settings.linkedinSendWindowStart = "09:00";
  return {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
  };
}

describe("LinkedIn sends outside the Outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses a custom invite link outside the Outbox", async () => {
    const ctx = context();
    const logCount = ctx.store.computerLogs.length;
    vi.mocked(browserSnapshot).mockResolvedValue(
      snapshot('[31] a "Invite Konrad Zuse to connect" /preload/custom-invite/')
    );

    const result = await executeTool("browser_click", { ref: 31 }, ctx);

    expect(result.result).toMatch(/^Refused:/);
    expect(result.approval).toBeUndefined();
    expect(browserClick).not.toHaveBeenCalled();
    expect(ctx.store.computerLogs).toHaveLength(logCount + 1);
    expect(ctx.store.computerLogs[0]?.summary.startsWith(logPrefix)).toBe(true);
  });

  it.each(["Connect", "Message", "Send"])(
    "refuses a %s click outside the Outbox",
    async (action) => {
      const ctx = context();
      vi.mocked(browserSnapshot).mockResolvedValue(snapshot(`[3] button "${action}"`));

      const result = await executeTool("browser_click", { ref: 3 }, ctx);

      expect(result.result).toMatch(/^Refused:/);
      expect(result.approval).toBeUndefined();
      expect(browserClick).not.toHaveBeenCalled();
    }
  );

  it("refuses a click by position outside the Outbox", async () => {
    const ctx = context();
    const logCount = ctx.store.computerLogs.length;
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot("Profile"));

    const result = await executeTool("browser_click", { x: 10, y: 20 }, ctx);

    expect(result.result).toMatch(/^Refused:/);
    expect(result.approval).toBeUndefined();
    expect(browserClick).not.toHaveBeenCalled();
    expect(ctx.store.computerLogs).toHaveLength(logCount + 1);
    expect(ctx.store.computerLogs[0]?.summary.startsWith(logPrefix)).toBe(true);
  });
});
