import { createRequire } from "node:module";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { snapshotPage } from "@/lib/browser";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

describe("snapshotPage sensitive field keywords", () => {
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
    '<input type="text" name="otp_input">',
    '<input type="text" name="passcode">',
    '<input type="text" name="client_secret">',
  ])("hides the value for %s", async (markup) => {
    document.body.innerHTML = markup;
    document.querySelector("input")!.value = "123456";

    const elements = await snapshotPage(fakePage);

    expect(elements[0].text).toBe("(password field)");
    expect(elements.every((element) => !element.text.includes("123456"))).toBe(true);
  });
});
