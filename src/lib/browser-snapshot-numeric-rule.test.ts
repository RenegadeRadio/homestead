import { createRequire } from "node:module";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { snapshotPage } from "@/lib/browser";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

describe("snapshotPage numeric field sensitivity", () => {
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

  it("does not extend the numeric-short rule past maxlength 8", async () => {
    document.body.innerHTML =
      '<input type="text" inputmode="numeric" maxlength="11">';
    document.querySelector("input")!.value = "12345678901";

    const elements = await snapshotPage(fakePage);

    expect(elements[0].text).toBe("12345678901");
  });

  it("requires inputmode numeric for the numeric-short rule", async () => {
    document.body.innerHTML = '<input type="text" maxlength="4">';
    document.querySelector("input")!.value = "8001";

    const elements = await snapshotPage(fakePage);

    expect(elements[0].text).toBe("8001");
  });
});
