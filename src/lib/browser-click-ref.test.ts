import { afterEach, describe, expect, it, vi } from "vitest";

import { browserClick, type SnapshotEl } from "@/lib/browser";

function botSession(lastSnapshot: SnapshotEl[], freshSnapshot: SnapshotEl[]) {
  const click = vi.fn();
  const evaluate = vi.fn().mockResolvedValueOnce(freshSnapshot).mockResolvedValue([]);
  globalThis.__crewBrowser = {
    context: {},
    page: {
      isClosed: () => false,
      mouse: { click },
      waitForTimeout: vi.fn(),
      evaluate,
      url: () => "https://www.linkedin.com/in/example",
      title: vi.fn().mockResolvedValue("LinkedIn"),
    },
    mode: "bot",
    takeoverReason: "",
    lastSnapshot,
    lastShot: null,
  } as unknown as NonNullable<typeof globalThis.__crewBrowser>;
  return { click, evaluate };
}

afterEach(() => {
  globalThis.__crewBrowser = undefined;
  globalThis.__crewBrowserLock = undefined;
});

describe("browserClick with a ref", () => {
  const oldMore: SnapshotEl = {
    ref: 5,
    tag: "button",
    role: "button",
    text: "More",
    x: 100,
    y: 200,
  };

  it("clicks the element at its fresh position after a layout shift", async () => {
    const page = botSession([oldMore], [
      { ref: 1, tag: "button", role: "button", text: "Contact info", x: 100, y: 200 },
      { ref: 2, tag: "button", role: "button", text: "More", x: 100, y: 260 },
    ]);

    await browserClick({ ref: 5 });

    expect(page.click).toHaveBeenCalledWith(100, 260);
    expect(page.click).not.toHaveBeenCalledWith(100, 200);
  });

  it("does not click when the old element is no longer present", async () => {
    const page = botSession([oldMore], [
      { ref: 1, tag: "a", role: "link", text: "More", x: 100, y: 200 },
    ]);

    const result = await browserClick({ ref: 5 });

    expect(page.click).not.toHaveBeenCalled();
    expect(result.result).toMatch(/^Not clicked: \[5\]/);
  });

  it("clicks the matching element nearest to its old position", async () => {
    const page = botSession([oldMore], [
      { ref: 1, tag: "button", role: "button", text: "More", x: 100, y: 250 },
      { ref: 2, tag: "button", role: "button", text: "More", x: 900, y: 40 },
    ]);

    await browserClick({ ref: 5 });

    expect(page.click).toHaveBeenCalledWith(100, 250);
  });
});
