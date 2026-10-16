import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserSnapshot: vi.fn(),
    browserClick: vi.fn(),
    browserNavigate: vi.fn(),
  };
});

vi.mock("@/lib/web", () => ({ fetchUrl: vi.fn(), webSearch: vi.fn() }));

import { browserClick, browserNavigate, browserSnapshot } from "@/lib/browser";
import { linkedInBudgetIO } from "@/lib/agent/linkedin-budget";
import { executeTool, type ToolContext } from "@/lib/agent/execute";
import { fetchUrl } from "@/lib/web";
import { createSeedStore } from "@/lib/seed";

const linkedInSnapshot = (url = "https://www.linkedin.com/feed/") => ({
  url,
  title: "LinkedIn",
  snapshot: '[3] button "More"',
  gate: { needed: false, reason: "" },
});

function context(): ToolContext {
  const store = createSeedStore();
  return {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
    extendTimeout: vi.fn(),
  };
}

describe("LinkedIn action and page safeguards", () => {
  const originalSleep = linkedInBudgetIO.sleep;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(browserSnapshot).mockResolvedValue(linkedInSnapshot());
    vi.mocked(browserClick).mockResolvedValue({
      ...linkedInSnapshot(),
      blocked: false,
      result: "clicked",
      label: "More",
    } as never);
  });

  afterEach(() => {
    linkedInBudgetIO.sleep = originalSleep;
  });

  it("waits between two default LinkedIn clicks and still performs the second", async () => {
    const ctx = context();
    const sleep = vi.fn(async (ms: number) => void ms);
    linkedInBudgetIO.sleep = sleep;

    await executeTool("browser_click", { ref: 3 }, ctx);
    await executeTool("browser_click", { ref: 3 }, ctx);

    expect(browserClick).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    const waited = sleep.mock.calls[0][0];
    expect(waited).toBeGreaterThanOrEqual(45_000);
    expect(waited).toBeLessThanOrEqual(150_000);
    expect(ctx.extendTimeout).toHaveBeenCalledWith(waited);
  });

  it("does not wait when gaps are zero or for non-LinkedIn navigation", async () => {
    const ctx = context();
    const sleep = vi.fn(async (ms: number) => void ms);
    linkedInBudgetIO.sleep = sleep;
    ctx.store.settings.linkedinActionGapMinSeconds = 0;
    ctx.store.settings.linkedinActionGapMaxSeconds = 0;
    await executeTool("browser_click", { ref: 3 }, ctx);
    await executeTool("browser_click", { ref: 3 }, ctx);

    vi.mocked(browserNavigate).mockResolvedValue({
      ...linkedInSnapshot("https://example.com/"),
      blocked: false,
    } as never);
    const defaults = context();
    await executeTool("browser_navigate", { url: "https://example.com/" }, defaults);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("refuses a LinkedIn navigate at 40 recent loads but ignores a 25-hour-old load", async () => {
    const ctx = context();
    const now = new Date();
    ctx.store.settings.linkedinActionGapMinSeconds = 0;
    ctx.store.settings.linkedinActionGapMaxSeconds = 0;
    ctx.store.settings.linkedinPageLoads = Array.from({ length: 40 }, (_, index) =>
      new Date(now.getTime() - (index + 1) * 60_000).toISOString()
    );
    const refused = await executeTool(
      "browser_navigate",
      { url: "https://www.linkedin.com/feed/" },
      ctx
    );
    expect(refused.result).toMatch(/^LinkedIn page budget:/);
    expect(browserNavigate).not.toHaveBeenCalled();

    ctx.store.settings.linkedinPageLoads = [
      new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(),
    ];
    vi.mocked(browserNavigate).mockResolvedValue({ ...linkedInSnapshot(), blocked: false } as never);
    await executeTool("browser_navigate", { url: "https://www.linkedin.com/feed/" }, ctx);
    expect(browserNavigate).toHaveBeenCalledOnce();
  });

  it("sets an automatic authwall hold and blocks the following LinkedIn navigation", async () => {
    const ctx = context();
    ctx.store.settings.linkedinActionGapMinSeconds = 0;
    ctx.store.settings.linkedinActionGapMaxSeconds = 0;
    vi.mocked(browserNavigate).mockResolvedValue({
      ...linkedInSnapshot("https://www.linkedin.com/authwall?trk=test"),
      blocked: false,
    } as never);
    const first = await executeTool(
      "browser_navigate",
      { url: "https://www.linkedin.com/feed/" },
      ctx
    );
    expect(first.result).toMatch(/^LinkedIn hold:/);
    expect(ctx.store.settings.linkedinHold).toContain("automatic: LinkedIn showed");

    const second = await executeTool(
      "browser_navigate",
      { url: "https://www.linkedin.com/in/test/" },
      ctx
    );
    expect(second.result).toMatch(/^LinkedIn hold:/);
    expect(browserNavigate).toHaveBeenCalledOnce();
  });

  it("returns the existing hold after a non-LinkedIn URL redirects to LinkedIn", async () => {
    const ctx = context();
    ctx.store.settings.linkedinHold = "operator hold";
    vi.mocked(browserNavigate).mockResolvedValue({
      ...linkedInSnapshot("https://www.linkedin.com/in/test/"),
      blocked: false,
    } as never);

    const outcome = await executeTool("browser_navigate", { url: "https://example.com/go" }, ctx);

    expect(outcome.result).toMatch(/^LinkedIn hold:/);
    expect(browserNavigate).toHaveBeenCalledOnce();
    expect(ctx.store.settings.linkedinPageLoads).toHaveLength(1);
  });

  it("refuses browse_url for LinkedIn without fetching", async () => {
    const outcome = await executeTool(
      "browse_url",
      { url: "https://www.linkedin.com/in/test/" },
      context()
    );
    expect(outcome.result).toMatch(/^LinkedIn page budget:/);
    expect(fetchUrl).not.toHaveBeenCalled();
  });
});
