import { createRequire } from "node:module";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { snapshotPage } from "@/lib/browser";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

describe("snapshotPage sensitive field labels", () => {
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

  it("hides a PIN value identified by aria-label", async () => {
    document.body.innerHTML = '<input type="text" aria-label="Enter PIN">';
    document.querySelector("input")!.value = "4821";

    const elements = await snapshotPage(fakePage);

    expect(elements[0].text).toBe("Enter PIN");
    expect(elements.every((element) => !element.text.includes("4821"))).toBe(true);
  });

  it("hides an SMS code value identified by placeholder", async () => {
    document.body.innerHTML = '<input type="text" placeholder="SMS code">';
    document.querySelector("input")!.value = "4821";

    const elements = await snapshotPage(fakePage);

    expect(elements[0].text).toBe("SMS code");
    expect(elements.every((element) => !element.text.includes("4821"))).toBe(true);
  });
});
