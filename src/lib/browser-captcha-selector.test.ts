import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { CAPTCHA_FRAME_SELECTOR } from "@/lib/browser";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

describe("CAPTCHA_FRAME_SELECTOR", () => {
  it("matches supported CAPTCHA iframes and ignores unrelated iframes", () => {
    const sources = [
      "https://www.google.com/recaptcha/api2/anchor",
      "https://newassets.hcaptcha.com/captcha/v1/abc",
      "https://client-api.arkoselabs.com/fc/gt2",
      "https://example.com/funcaptcha/frame",
      "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile",
    ];
    const unrelated = "https://www.youtube.com/embed/abc";
    const dom = new JSDOM("<!doctype html><body></body>");
    dom.window.document.body.innerHTML = [...sources, unrelated]
      .map((src) => `<iframe src="${src}"></iframe>`)
      .join("");

    const matches = dom.window.document.querySelectorAll(CAPTCHA_FRAME_SELECTOR);
    const matchedSources = Array.from(matches as NodeListOf<Element>).map((element) =>
      element.getAttribute("src")
    );

    expect(matches).toHaveLength(5);
    expect(matchedSources).toEqual(sources);
    expect(matchedSources).not.toContain(unrelated);
  });
});
