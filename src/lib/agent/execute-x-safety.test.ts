import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserNavigate: vi.fn(),
    browserSnapshot: vi.fn(),
    browserClick: vi.fn(),
    browserScroll: vi.fn(),
  };
});
vi.mock("@/lib/web", () => ({ fetchUrl: vi.fn(), webSearch: vi.fn() }));

import { browserClick, browserNavigate, browserScroll, browserSnapshot } from "@/lib/browser";
import { executeTool, type ToolContext } from "@/lib/agent/execute";
import { xBudgetIO } from "@/lib/agent/x-budget";
import { createSeedStore } from "@/lib/seed";

const page = (url: string) => ({
  url,
  title: "Page",
  snapshot: '[4] link "Home"',
  gate: { needed: false, reason: "" },
  blocked: false,
  result: "done",
});

function context(): ToolContext {
  const store = createSeedStore();
  return {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
  };
}

describe("X action safety", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it("waits between allowed navigations and does not wait for a budget refusal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
    const ctx = context();
    const sleep = vi.spyOn(xBudgetIO, "sleep").mockResolvedValue();
    vi.mocked(browserNavigate).mockResolvedValue(page("https://x.com/search") as never);

    await executeTool("browser_navigate", { url: "https://x.com/search?q=one" }, ctx);
    expect(sleep).not.toHaveBeenCalled();
    await executeTool("browser_navigate", { url: "https://x.com/search?q=two" }, ctx);
    expect(sleep).toHaveBeenCalledOnce();
    const waitMs = sleep.mock.calls[0][0];
    expect(waitMs).toBeGreaterThanOrEqual(30_000);
    expect(waitMs).toBeLessThanOrEqual(90_000);

    sleep.mockClear();
    ctx.store.settings.xDailyPageLoads = 1;
    ctx.store.settings.xPageLoads = [new Date().toISOString()];
    const result = await executeTool("browser_navigate", { url: "https://x.com/search?q=three" }, ctx);
    expect(result.result).toMatch(/^X page budget:/);
    expect(sleep).not.toHaveBeenCalled();
    expect(browserNavigate).toHaveBeenCalledTimes(2);
  });

  it("sets an automatic hold on login and refuses later X work without browser calls", async () => {
    const ctx = context();
    const sleep = vi.spyOn(xBudgetIO, "sleep").mockResolvedValue();
    vi.mocked(browserNavigate).mockResolvedValue(page("https://x.com/i/flow/login") as never);

    const first = await executeTool("browser_navigate", { url: "https://x.com/home" }, ctx);
    expect(first.result).toMatch(/^X hold:/);
    expect(ctx.store.settings.xHold).toContain("automatic: X showed");

    vi.mocked(browserNavigate).mockClear();
    sleep.mockClear();
    const second = await executeTool("browser_navigate", { url: "https://x.com/search" }, ctx);
    expect(second.result).toMatch(/^X hold:/);
    expect(browserNavigate).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();

    vi.mocked(browserSnapshot).mockResolvedValue(page("https://x.com/home") as never);
    expect((await executeTool("browser_click", { ref: 4 }, ctx)).result).toMatch(/^X hold:/);
    expect((await executeTool("browser_scroll", { direction: "down" }, ctx)).result).toMatch(/^X hold:/);
    expect(browserClick).not.toHaveBeenCalled();
    expect(browserScroll).not.toHaveBeenCalled();
  });
});
