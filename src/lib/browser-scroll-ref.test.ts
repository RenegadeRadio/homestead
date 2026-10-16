import { afterEach, describe, expect, it, vi } from "vitest";

import { browserScroll } from "@/lib/browser";

function botSession(lastSnapshot: NonNullable<typeof globalThis.__crewBrowser>["lastSnapshot"]) {
  const move = vi.fn();
  const wheel = vi.fn();
  const click = vi.fn();
  const evaluate = vi.fn().mockResolvedValue([]);
  globalThis.__crewBrowser = {
    context: {},
    page: {
      isClosed: () => false,
      mouse: { move, wheel, click },
      waitForTimeout: vi.fn(),
      evaluate,
      url: () => "https://www.linkedin.com/sales/search/people",
      title: vi.fn().mockResolvedValue("Sales Navigator"),
    },
    mode: "bot",
    takeoverReason: "",
    lastSnapshot,
    lastShot: null,
  } as unknown as NonNullable<typeof globalThis.__crewBrowser>;
  return { move, wheel, click, evaluate };
}

afterEach(() => {
  globalThis.__crewBrowser = undefined;
  globalThis.__crewBrowserLock = undefined;
});

describe("browserScroll with a ref", () => {
  it("moves over the referenced element before scrolling without clicking", async () => {
    const page = botSession([
      { ref: 5, tag: "div", role: "list", text: "Results", x: 100, y: 200 },
    ]);

    await browserScroll("down", 5);

    expect(page.move).toHaveBeenCalledWith(100, 200);
    expect(page.wheel).toHaveBeenCalledWith(0, 700);
    expect(page.move.mock.invocationCallOrder[0]).toBeLessThan(
      page.wheel.mock.invocationCallOrder[0]
    );
    expect(page.click).not.toHaveBeenCalled();
  });

  it("captures once and does not scroll when the ref is still missing", async () => {
    const page = botSession([]);

    const result = await browserScroll("down", 5);

    expect(result.result).toContain("[5]");
    expect(page.evaluate).toHaveBeenCalledOnce();
    expect(page.wheel).not.toHaveBeenCalled();
  });
});
