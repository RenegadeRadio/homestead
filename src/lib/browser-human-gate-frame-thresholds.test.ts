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

const base: FrameCheck = {
  host: "www.google.com",
  width: 300,
  height: 80,
  intersectsViewport: true,
  visibility: "visible",
  display: "block",
  opacity: "1",
};

function fakePage(frames: FrameCheck[]) {
  return {
    url: () => "https://example.com/",
    title: async () => "Example",
    locator: (selector: string) => ({
      evaluateAll: async () => (selector === CAPTCHA_FRAME_SELECTOR ? frames : []),
      count: async () => (selector === CAPTCHA_FRAME_SELECTOR ? frames.length : 0),
      innerText: async () => "",
    }),
  } as unknown as Page;
}

describe("looksLikeHumanGate CAPTCHA frame thresholds", () => {
  it("ignores a frame narrower than the challenge threshold", async () => {
    await expect(
      looksLikeHumanGate(fakePage([{ ...base, width: 50, height: 80 }]))
    ).resolves.toEqual({ needed: false, reason: "" });
  });

  it("ignores a frame shorter than the challenge threshold", async () => {
    await expect(
      looksLikeHumanGate(fakePage([{ ...base, width: 300, height: 30 }]))
    ).resolves.toEqual({ needed: false, reason: "" });
  });

  it("ignores a frame with display none", async () => {
    await expect(
      looksLikeHumanGate(fakePage([{ ...base, display: "none" }]))
    ).resolves.toEqual({ needed: false, reason: "" });
  });

  it("ignores a fully transparent frame", async () => {
    await expect(
      looksLikeHumanGate(fakePage([{ ...base, opacity: "0" }]))
    ).resolves.toEqual({ needed: false, reason: "" });
  });
});
