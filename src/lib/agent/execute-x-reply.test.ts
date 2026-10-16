import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserSnapshot: vi.fn(),
    browserClick: vi.fn(),
    browserType: vi.fn(),
    browserPress: vi.fn(),
    browserNavigate: vi.fn(),
    setBrowserMode: vi.fn(),
  };
});
vi.mock("@/lib/web", () => ({ fetchUrl: vi.fn(), webSearch: vi.fn() }));

import { browserClick, browserNavigate, browserPress, browserSnapshot, browserType } from "@/lib/browser";
import { executeTool, type ToolContext } from "@/lib/agent/execute";
import { xBudgetIO } from "@/lib/agent/x-budget";
import { createSeedStore } from "@/lib/seed";

const snapshot = (url: string, line = '[3] button "Reply"') => ({
  url,
  title: "Page",
  snapshot: line,
  gate: { needed: false, reason: "" },
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

const valid = {
  postUrl: "https://x.com/handle/status/12345",
  author: "handle",
  postExcerpt: "A claim about coding agents",
  text: "x".repeat(240),
};

describe("X reply safeguards", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records valid X status replies and refuses invalid inputs without storing them", async () => {
    const ctx = context();
    await executeTool("record_x_reply", valid, ctx);
    expect(ctx.store.xReplies).toHaveLength(1);
    expect(ctx.store.xReplies?.[0]).toMatchObject({ status: "draft", createdBy: ctx.bot.id });

    for (const args of [
      { ...valid, postUrl: "https://www.linkedin.com/in/person" },
      { ...valid, postUrl: "https://x.com/handle" },
      { ...valid, text: "x".repeat(281) },
      { ...valid, postExcerpt: "x".repeat(501) },
      { ...valid, text: "This uses an em dash — here." },
    ]) {
      const refused = context();
      expect((await executeTool("record_x_reply", args, refused)).result).not.toContain("Saved X reply");
      expect(refused.store.xReplies ?? []).toHaveLength(0);
    }
  });

  it("refuses a duplicate across X domains and accepts twitter.com", async () => {
    const ctx = context();
    await executeTool("record_x_reply", valid, ctx);
    const duplicate = await executeTool("record_x_reply", {
      ...valid,
      postUrl: "https://twitter.com/other/status/12345/",
    }, ctx);
    expect(duplicate.result).toMatch(/^Refused:/);
    expect(ctx.store.xReplies).toHaveLength(1);

    const twitter = context();
    await executeTool("record_x_reply", { ...valid, postUrl: "https://twitter.com/handle/status/9" }, twitter);
    expect(twitter.store.xReplies).toHaveLength(1);
  });

  it("refuses typing, pressing, and reply clicks on X but permits unrelated controls", async () => {
    const ctx = context();
    vi.mocked(browserSnapshot).mockResolvedValue(snapshot("https://x.com/search?q=cursor") as never);
    for (const [tool, args] of [
      ["browser_type", { text: "hello" }],
      ["browser_press", { key: "Enter" }],
      ["browser_click", { ref: 3 }],
    ] as const) {
      expect((await executeTool(tool, args, ctx)).result).toContain("record_x_reply");
    }
    expect(browserType).not.toHaveBeenCalled();
    expect(browserPress).not.toHaveBeenCalled();
    expect(browserClick).not.toHaveBeenCalled();

    vi.mocked(browserSnapshot).mockResolvedValue(snapshot("https://x.com/home", '[4] link “Home”') as never);
    vi.mocked(browserClick).mockResolvedValue({ ...snapshot("https://x.com/home"), blocked: false, result: "clicked", label: "Home" } as never);
    await executeTool("browser_click", { ref: 4 }, ctx);
    expect(browserClick).toHaveBeenCalledOnce();

    vi.mocked(browserSnapshot).mockResolvedValue(snapshot("https://example.com", '[3] button "Reply"') as never);
    await executeTool("browser_click", { ref: 3 }, ctx);
    expect(browserClick).toHaveBeenCalledTimes(2);
  });

  it("refuses X action controls when the action word appears anywhere in the name", async () => {
    const ctx = context();

    for (const name of ["40 Likes. Like", "12 Reposts. Repost", "5 Replies. Reply", "Following"]) {
      vi.mocked(browserSnapshot).mockResolvedValue(
        snapshot("https://x.com/home", `[3] button “${name}”`) as never
      );
      expect((await executeTool("browser_click", { ref: 3 }, ctx)).result).toContain("record_x_reply");
      expect(browserClick).not.toHaveBeenCalled();
    }

    for (const [index, name] of ["Search", "Show more"].entries()) {
      vi.mocked(browserSnapshot).mockResolvedValue(
        snapshot("https://x.com/home", `[3] button “${name}”`) as never
      );
      vi.mocked(browserClick).mockResolvedValue({
        ...snapshot("https://x.com/home"),
        blocked: false,
        result: "clicked",
        label: name,
      } as never);
      await executeTool("browser_click", { ref: 3 }, ctx);
      expect(browserClick).toHaveBeenCalledTimes(index + 1);
    }
  });

  it("allows the 30th X load, refuses the 31st, and keeps budgets separate", async () => {
    vi.spyOn(xBudgetIO, "sleep").mockResolvedValue();
    const ctx = context();
    const now = Date.now();
    ctx.store.settings.xPageLoads = Array.from({ length: 29 }, (_, i) =>
      new Date(now - (i + 1) * 60_000).toISOString()
    );
    ctx.store.settings.linkedinPageLoads = [new Date(now - 60_000).toISOString()];
    vi.mocked(browserNavigate).mockResolvedValue({ ...snapshot("https://x.com/search"), blocked: false } as never);
    await executeTool("browser_navigate", { url: "https://x.com/search?q=x" }, ctx);
    expect(ctx.store.settings.xPageLoads).toHaveLength(30);
    expect(ctx.store.settings.linkedinPageLoads).toHaveLength(1);
    expect((await executeTool("browser_navigate", { url: "https://x.com/search?q=y" }, ctx)).result).toMatch(/^X page budget:/);
    expect(browserNavigate).toHaveBeenCalledOnce();

    ctx.store.settings.xPageLoads = [new Date(now - 25 * 60 * 60 * 1000).toISOString()];
    ctx.store.settings.xDailyPageLoads = 1;
    await executeTool("browser_navigate", { url: "https://x.com/search?q=z" }, ctx);
    expect(browserNavigate).toHaveBeenCalledTimes(2);

    ctx.store.settings.linkedinActionGapMinSeconds = 0;
    ctx.store.settings.linkedinActionGapMaxSeconds = 0;
    vi.mocked(browserNavigate).mockResolvedValue({ ...snapshot("https://www.linkedin.com/feed"), blocked: false } as never);
    const xCount = ctx.store.settings.xPageLoads?.length ?? 0;
    await executeTool("browser_navigate", { url: "https://www.linkedin.com/feed" }, ctx);
    expect(ctx.store.settings.xPageLoads).toHaveLength(xCount);
    expect(ctx.store.settings.linkedinPageLoads).toHaveLength(2);
  });
});
