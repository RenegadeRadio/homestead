import type { Page } from "playwright";
import { describe, expect, it } from "vitest";

import { CAPTCHA_FRAME_SELECTOR, looksLikeHumanGate } from "@/lib/browser";

function fakePage({
  url = "https://example.com/",
  title = "Example",
  password = 0,
  captchaFrames = 0,
  body = "",
}: {
  url?: string;
  title?: string;
  password?: number;
  captchaFrames?: number;
  body?: string;
} = {}) {
  return {
    url: () => url,
    title: async () => title,
    locator: (selector: string) => ({
      evaluateAll: async () =>
        captchaFrames > 0
          ? [
              {
                host: "",
                width: 300,
                height: 80,
                intersectsViewport: true,
                visibility: "visible",
                display: "block",
                opacity: "1",
              },
            ]
          : [],
      count: async () =>
        selector === CAPTCHA_FRAME_SELECTOR
          ? captchaFrames
          : selector === 'input[type="password"]'
            ? password
            : 0,
      innerText: async () => body,
    }),
  } as unknown as Page;
}

describe("looksLikeHumanGate", () => {
  it("ignores gate keywords in a long LinkedIn feed", async () => {
    const body = `${"ordinary feed content ".repeat(100)} challenge unusual activity verification code`;

    await expect(
      looksLikeHumanGate(
        fakePage({
          url: "https://www.linkedin.com/feed/",
          title: "Feed | LinkedIn",
          body,
        })
      )
    ).resolves.toEqual({ needed: false, reason: "" });
  });

  it("detects a CAPTCHA iframe", async () => {
    await expect(looksLikeHumanGate(fakePage({ captchaFrames: 1 }))).resolves.toEqual({
      needed: true,
      reason: "This page is asking for a CAPTCHA or human check.",
      signal: "captcha frame",
    });
  });

  it("detects a CAPTCHA title", async () => {
    await expect(looksLikeHumanGate(fakePage({ title: "Just a moment..." }))).resolves.toEqual({
      needed: true,
      reason: "This page is asking for a CAPTCHA or human check.",
      signal: "captcha title",
    });
  });

  it("detects CAPTCHA copy on a short page", async () => {
    await expect(
      looksLikeHumanGate(fakePage({ body: "Verify you are human to continue" }))
    ).resolves.toEqual({
      needed: true,
      reason: "This page is asking for a CAPTCHA or human check.",
      signal: "captcha text: Verify you are human",
    });
  });

  it("detects a LinkedIn checkpoint URL", async () => {
    await expect(
      looksLikeHumanGate(
        fakePage({ url: "https://www.linkedin.com/checkpoint/challenge/abc" })
      )
    ).resolves.toEqual({
      needed: true,
      reason: "This page needs a sign-in, password, or 2FA step.",
      signal: "login url",
    });
  });
});
