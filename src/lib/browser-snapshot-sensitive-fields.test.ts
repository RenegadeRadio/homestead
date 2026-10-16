import { createRequire } from "node:module";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { snapshotPage } from "@/lib/browser";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

describe("snapshotPage sensitive field heuristics", () => {
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
  });

  const fakePage = {
    evaluate: async (fn: (arg?: unknown) => unknown) => fn(),
  } as unknown as Page;

  it.each([
    ['<input type="text" name="pin">', "4821"],
    ['<input type="text" inputmode="numeric" maxlength="1">', "7"],
    ['<input type="text" id="verification_code">', "123456"],
  ])("hides the value for %s", async (markup, value) => {
    document.body.innerHTML = markup;
    document.querySelector("input")!.value = value;

    const elements = await snapshotPage(fakePage);

    expect(elements[0].text).toBe("(password field)");
    expect(elements.every((element) => !element.text.includes(value))).toBe(true);
  });

  it("preserves an ordinary input value", async () => {
    document.body.innerHTML = '<input type="text" name="city">';
    document.querySelector("input")!.value = "Cape Town";

    const elements = await snapshotPage(fakePage);

    expect(elements[0].text).toBe("Cape Town");
  });
});
