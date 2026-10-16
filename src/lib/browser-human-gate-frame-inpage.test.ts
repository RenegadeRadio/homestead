import { createRequire } from "node:module";
import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CAPTCHA_FRAME_SELECTOR, looksLikeHumanGate } from "@/lib/browser";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

function buildFrame(rect: { left: number; top: number; width: number; height: number }) {
  const dom = new JSDOM(
    '<!doctype html><body><iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe></body>',
    { url: "https://example.com/" }
  );
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("Element", dom.window.Element);
  const frame = document.querySelector(CAPTCHA_FRAME_SELECTOR)!;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    width: rect.width,
    height: rect.height,
    x: rect.left,
    y: rect.top,
    toJSON() {},
  } as DOMRect);
  return frame;
}

function stubViewport(options: {
  innerWidth: number;
  innerHeight: number;
  visibility?: string;
  display?: string;
  opacity?: string;
}) {
  vi.stubGlobal("innerWidth", options.innerWidth);
  vi.stubGlobal("innerHeight", options.innerHeight);
  vi.stubGlobal("location", { href: "https://example.com/" });
  vi.stubGlobal("getComputedStyle", () => ({
    visibility: options.visibility ?? "visible",
    display: options.display ?? "block",
    opacity: options.opacity ?? "1",
  }));
}

function fakePage(frames: Element[]) {
  return {
    url: () => "https://example.com/",
    title: async () => "Example",
    locator: (selector: string) => ({
      evaluateAll: async (fn: (elements: Element[]) => unknown) =>
        selector === CAPTCHA_FRAME_SELECTOR ? fn(frames) : [],
      count: async () => (selector === CAPTCHA_FRAME_SELECTOR ? frames.length : 0),
      innerText: async () => "",
    }),
  } as unknown as Page;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("looksLikeHumanGate CAPTCHA frame in-page checks", () => {
  it("flags a visible reCAPTCHA challenge frame in the viewport", async () => {
    const frame = buildFrame({ left: 10, top: 10, width: 304.4, height: 78.2 });
    stubViewport({ innerWidth: 1280, innerHeight: 800 });

    await expect(looksLikeHumanGate(fakePage([frame]))).resolves.toEqual({
      needed: true,
      reason: "This page is asking for a CAPTCHA or human check.",
      signal: "captcha frame",
      detail: "www.google.com 304x78",
    });
  });

  it("ignores the same frame when it sits below the viewport", async () => {
    const frame = buildFrame({ left: 10, top: 900, width: 304.4, height: 78.2 });
    stubViewport({ innerWidth: 1280, innerHeight: 800 });

    await expect(looksLikeHumanGate(fakePage([frame]))).resolves.toEqual({
      needed: false,
      reason: "",
    });
  });

  it("ignores the same frame when computed visibility is hidden", async () => {
    const frame = buildFrame({ left: 10, top: 10, width: 304.4, height: 78.2 });
    stubViewport({ innerWidth: 1280, innerHeight: 800, visibility: "hidden" });

    await expect(looksLikeHumanGate(fakePage([frame]))).resolves.toEqual({
      needed: false,
      reason: "",
    });
  });
});
