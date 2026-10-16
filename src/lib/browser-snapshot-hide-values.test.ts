import { createRequire } from "node:module";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browserSnapshot, snapshotPage } from "@/lib/browser";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

describe("snapshotPage hidden values", () => {
  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><body></body>");
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("Element", dom.window.Element);
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 20,
      height: 20,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 20,
      bottom: 20,
      toJSON() {},
    } as DOMRect);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.__crewBrowser = undefined;
    globalThis.__crewBrowserLock = undefined;
  });

  it("does not expose ordinary input values when requested", async () => {
    document.body.innerHTML = '<input type="text" name="city">';
    document.querySelector("input")!.value = "Cape Town";
    const fakePage = {
      evaluate: async (fn: (arg?: unknown) => unknown, arg?: unknown) => fn(arg),
    } as unknown as Page;

    const elements = await snapshotPage(fakePage, { hideValues: true });

    expect(elements[0].text).toBe("(input)");
    expect(elements.every((element) => !element.text.includes("Cape Town"))).toBe(true);
  });

  it("passes hidden-value mode to evaluate for a human session", async () => {
    const evaluate = vi.fn().mockResolvedValue([]);
    globalThis.__crewBrowser = {
      context: {},
      page: {
        isClosed: () => false,
        url: () => "https://example.com",
        title: async () => "Example",
        locator: () => ({ count: async () => 0, innerText: async () => "", evaluateAll: async () => [] }),
        evaluate,
      },
      mode: "human",
      takeoverReason: "Sign in",
      lastSnapshot: [],
      lastShot: null,
    } as unknown as NonNullable<typeof globalThis.__crewBrowser>;

    await browserSnapshot();

    expect(evaluate).toHaveBeenCalledWith(expect.any(Function), { hideValues: true });
  });
});
