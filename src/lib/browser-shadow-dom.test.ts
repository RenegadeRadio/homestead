import { createRequire } from "node:module";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { composeDialogText, snapshotPage } from "@/lib/browser";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

describe("browser shadow DOM inspection", () => {
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

  it("lists a shadow-root textbox before light-document elements", async () => {
    document.body.innerHTML = '<a href="#">Home</a><div id="host"></div>';
    const host = document.querySelector("#host")!;
    host.attachShadow({ mode: "open" }).innerHTML = '<div role="textbox">Compose</div>';

    const elements = await snapshotPage(fakePage);
    const textboxIndex = elements.findIndex((element) => element.role === "textbox");
    const linkIndex = elements.findIndex((element) => element.tag === "a");

    expect(textboxIndex).toBeGreaterThanOrEqual(0);
    expect(textboxIndex).toBeLessThan(linkIndex);
  });

  it("returns collapsed dialog text from an open shadow root", async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.querySelector("#host")!;
    host.attachShadow({ mode: "open" }).innerHTML = `
      <div role="dialog">Write to   Ada <div role="textbox"> Hello\n world </div></div>
    `;

    await expect(composeDialogText(fakePage)).resolves.toBe("Write to Ada");
  });
});
