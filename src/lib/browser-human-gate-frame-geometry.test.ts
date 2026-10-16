import type { Page } from "playwright";
import { describe, expect, it } from "vitest";

import { CAPTCHA_FRAME_SELECTOR, looksLikeHumanGate } from "@/lib/browser";

type FrameCheck = {
  host: string;
  width: number;
  height: number;
  intersectsViewport: boolean;
  visibility: string;
  display: string;
  opacity: string;
};

function fakePage(frame: FrameCheck) {
  return {
    url: () => "https://example.com/",
    title: async () => "Example",
    locator: (selector: string) => ({
      evaluateAll: async () => (selector === CAPTCHA_FRAME_SELECTOR ? [frame] : []),
      count: async () => 0,
      innerText: async () => "",
    }),
  } as unknown as Page;
}

const visibleFrame: FrameCheck = {
  host: "x",
  width: 300,
  height: 80,
  intersectsViewport: true,
  visibility: "visible",
  display: "block",
  opacity: "1",
};

describe("looksLikeHumanGate CAPTCHA frame geometry", () => {
  it("ignores a zero-size CAPTCHA-provider frame", async () => {
    await expect(
      looksLikeHumanGate(fakePage({ ...visibleFrame, width: 0, height: 0 }))
    ).resolves.toEqual({ needed: false, reason: "" });
  });

  it("ignores a hidden CAPTCHA-provider frame", async () => {
    await expect(
      looksLikeHumanGate(fakePage({ ...visibleFrame, visibility: "hidden" }))
    ).resolves.toEqual({ needed: false, reason: "" });
  });

  it("ignores a CAPTCHA-provider frame below the viewport", async () => {
    await expect(
      looksLikeHumanGate(fakePage({ ...visibleFrame, intersectsViewport: false }))
    ).resolves.toEqual({ needed: false, reason: "" });
  });

  it("reports a visible challenge-sized CAPTCHA frame with its details", async () => {
    await expect(
      looksLikeHumanGate(
        fakePage({
          ...visibleFrame,
          host: "www.google.com",
          width: 304,
          height: 78,
        })
      )
    ).resolves.toEqual({
      needed: true,
      reason: "This page is asking for a CAPTCHA or human check.",
      signal: "captcha frame",
      detail: "www.google.com 304x78",
    });
  });
});
