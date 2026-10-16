import { createRequire } from "node:module";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { snapshotPage } from "@/lib/browser";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

describe("snapshotPage sensitive inputs", () => {
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
    evaluate: async (fn: () => unknown) => fn(),
  } as unknown as Page;

  it("replaces an unlabelled password value with fixed text", async () => {
    document.body.innerHTML = '<input type="password">';
    document.querySelector("input")!.value = "hunter2";

    const elements = await snapshotPage(fakePage);

    expect(elements[0].text).toBe("(password field)");
    expect(elements.every((element) => !element.text.includes("hunter2"))).toBe(true);
  });

  it("uses a password label while preserving ordinary input values", async () => {
    document.body.innerHTML =
      '<input type="password" aria-label="Password"><input type="text">';
    const inputs = document.querySelectorAll("input");
    inputs[0].value = "hunter2";
    inputs[1].value = "hi";

    const elements = await snapshotPage(fakePage);

    expect(elements.map((element) => element.text)).toEqual(["Password", "hi"]);
    expect(elements.every((element) => !element.text.includes("hunter2"))).toBe(true);
  });

  it("does not expose one-time-code values", async () => {
    document.body.innerHTML = '<input autocomplete="one-time-code">';
    document.querySelector("input")!.value = "123456";

    const elements = await snapshotPage(fakePage);

    expect(elements[0].text).toBe("(password field)");
    expect(elements.every((element) => !element.text.includes("123456"))).toBe(true);
  });
});
