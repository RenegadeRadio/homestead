import { afterEach, describe, expect, it, vi } from "vitest";

import { browserNavigate, browserPress, browserScroll } from "@/lib/browser";

const blocked = {
  blocked: true,
  result: "The user has the computer. Wait until they continue.",
};

function humanSession() {
  const goto = vi.fn();
  const press = vi.fn();
  const wheel = vi.fn();
  globalThis.__crewBrowser = {
    context: {},
    page: {
      isClosed: () => false,
      goto,
      keyboard: { press },
      mouse: { wheel },
    },
    mode: "human",
    takeoverReason: "Sign in",
    lastSnapshot: [],
    lastShot: null,
  } as unknown as NonNullable<typeof globalThis.__crewBrowser>;
  return { goto, press, wheel };
}

afterEach(() => {
  globalThis.__crewBrowser = undefined;
  globalThis.__crewBrowserLock = undefined;
});

describe("browser takeover", () => {
  it("blocks navigation without touching the page", async () => {
    const page = humanSession();

    await expect(browserNavigate("https://example.com")).resolves.toEqual(blocked);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it("blocks key presses without touching the page", async () => {
    const page = humanSession();

    await expect(browserPress("Enter")).resolves.toEqual(blocked);
    expect(page.press).not.toHaveBeenCalled();
  });

  it("blocks scrolling without touching the page", async () => {
    const page = humanSession();

    await expect(browserScroll("down")).resolves.toEqual(blocked);
    expect(page.wheel).not.toHaveBeenCalled();
  });
});
