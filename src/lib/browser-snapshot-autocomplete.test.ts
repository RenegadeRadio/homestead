import { createRequire } from "node:module";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { snapshotPage } from "@/lib/browser";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

describe("snapshotPage sensitive autocomplete values", () => {
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

  it.each(["current-password", "new-password", "One-Time-Code"])(
    "does not expose a value marked autocomplete=%s",
    async (autocomplete) => {
      document.body.innerHTML = `<input type="text" autocomplete="${autocomplete}">`;
      document.querySelector("input")!.value = "secret-value";

      const elements = await snapshotPage(fakePage);

      expect(elements[0].text).toBe("(password field)");
      expect(elements.every((element) => !element.text.includes("secret-value"))).toBe(true);
    }
  );

  it("uses a password placeholder without exposing its value", async () => {
    document.body.innerHTML = '<input type="password" placeholder="Password">';
    document.querySelector("input")!.value = "hunter2";

    const elements = await snapshotPage(fakePage);

    expect(elements[0].text).toBe("Password");
    expect(elements.every((element) => !element.text.includes("hunter2"))).toBe(true);
  });
});
