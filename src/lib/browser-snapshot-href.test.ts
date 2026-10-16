import { createRequire } from "node:module";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatSnapshot, snapshotPage } from "@/lib/browser";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

describe("snapshotPage link destinations", () => {
  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><body></body>", {
      url: "https://app.example.com/search",
    });
    Object.defineProperty(dom.window.HTMLElement.prototype, "innerText", {
      configurable: true,
      get() {
        return this.textContent || "";
      },
      set(value) {
        this.textContent = value;
      },
    });
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
    evaluate: async (fn: (arg?: unknown) => unknown, arg?: unknown) => fn(arg),
  } as unknown as Page;

  it("prints same-origin and cross-origin link destinations", async () => {
    document.body.innerHTML =
      '<a href="/in/sarah-smith">Sarah Smith</a><a href="https://other.example.com/about">Other Co</a>';

    const elements = await snapshotPage(fakePage);
    const output = formatSnapshot("https://app.example.com/search", "Search", elements);

    expect(output).toContain('[1] a “Sarah Smith” /in/sarah-smith');
    expect(output).toContain('[2] a “Other Co” https://other.example.com/about');
  });

  it("drops query strings and fragments from destinations", async () => {
    document.body.innerHTML =
      '<a href="/in/sarah-smith?trk=abc123&sessionid=xyz#profile-card">Sarah Smith</a>';

    const elements = await snapshotPage(fakePage);
    const output = formatSnapshot("https://app.example.com/search", "Search", elements);

    expect(elements[0].href).toBe("https://app.example.com/in/sarah-smith");
    expect(output.split("\n").find((line) => line.startsWith("[1]"))).toBe(
      '[1] a “Sarah Smith” /in/sarah-smith'
    );
    expect(output).not.toContain("trk=abc123");
    expect(output).not.toContain("profile-card");
  });

  it("does not add destinations to buttons or text inputs", async () => {
    document.body.innerHTML =
      '<button>Connect</button><input type="text" name="city" value="Cape Town">';

    const elements = await snapshotPage(fakePage);
    const lines = formatSnapshot("https://app.example.com/search", "Search", elements).split("\n");

    expect(elements[0].href).toBeUndefined();
    expect(elements[1].href).toBeUndefined();
    expect(lines.find((line) => line.startsWith("[1]"))).toBe('[1] button “Connect”');
    expect(lines.find((line) => line.startsWith("[2]"))).toBe('[2] input “Cape Town”');
  });

  it.each(["javascript:void(0)", "mailto:sarah@example.com", "tel:+15551234567"])(
    "does not add a destination for %s",
    async (href) => {
      document.body.innerHTML = `<a href="${href}">Contact</a>`;

      const elements = await snapshotPage(fakePage);
      const line = formatSnapshot(
        "https://app.example.com/search",
        "Search",
        elements
      )
        .split("\n")
        .find((candidate) => candidate.startsWith("[1]"));

      expect(elements[0].href).toBeUndefined();
      expect(line).toBe('[1] a “Contact”');
    }
  );
});
