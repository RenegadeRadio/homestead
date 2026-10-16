import type { Page } from "playwright";
import { describe, expect, it } from "vitest";

import { CAPTCHA_FRAME_SELECTOR, looksLikeHumanGate } from "@/lib/browser";

const captchaReason = "This page is asking for a CAPTCHA or human check.";
const loginReason = "This page needs a sign-in, password, or 2FA step.";

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

describe("looksLikeHumanGate signals", () => {
  it("detects a security check title as a CAPTCHA", async () => {
    await expect(looksLikeHumanGate(fakePage({ title: "Security Check" }))).resolves.toEqual({
      needed: true,
      reason: captchaReason,
      signal: "captcha title",
    });
  });

  it("detects a password input even on a long page", async () => {
    await expect(
      looksLikeHumanGate(
        fakePage({
          url: "https://www.linkedin.com/feed/",
          title: "Feed | LinkedIn",
          password: 1,
          body: "x".repeat(1600),
        })
      )
    ).resolves.toEqual({ needed: true, reason: loginReason, signal: "password input" });
  });

  it("detects a sign-in title", async () => {
    await expect(
      looksLikeHumanGate(
        fakePage({ url: "https://www.linkedin.com/feed/", title: "Sign In | LinkedIn" })
      )
    ).resolves.toEqual({ needed: true, reason: loginReason, signal: "login title" });
  });

  it("detects verification-code copy only on a short page", async () => {
    const body = "Enter the verification code we sent";
    const page = { url: "https://www.linkedin.com/feed/", title: "Feed | LinkedIn" };

    await expect(looksLikeHumanGate(fakePage({ ...page, body }))).resolves.toEqual({
      needed: true,
      reason: loginReason,
      signal: "login text: verification code",
    });
    await expect(
      looksLikeHumanGate(fakePage({ ...page, body: `${body} ${"x".repeat(1500)}` }))
    ).resolves.toEqual({ needed: false, reason: "" });
  });

  it("detects sign-in copy with a login detail", async () => {
    await expect(
      looksLikeHumanGate(
        fakePage({
          url: "https://www.linkedin.com/feed/",
          title: "Feed | LinkedIn",
          body: "Sign in to continue. Forgot password?",
        })
      )
    ).resolves.toEqual({
      needed: true,
      reason: loginReason,
      signal: "login text: Forgot password",
    });
  });
});
