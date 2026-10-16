import { createRequire } from "node:module";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { composeDialogText } from "@/lib/browser";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

describe("composeDialogText editable exclusion", () => {
  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><body></body>");
    vi.stubGlobal("document", dom.window.document);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fakePage = {
    evaluate: async (fn: () => unknown) => fn(),
  } as unknown as Page;

  it("leaves unsent message text in an editable box out of dialog text", async () => {
    document.body.innerHTML = `
      <div role="dialog"><div contenteditable="true">Hi Edith, a test</div></div>
    `;

    await expect(composeDialogText(fakePage)).resolves.not.toContain("Hi Edith, a test");
  });

  it("keeps the recipient and sent message outside an empty editable box", async () => {
    document.body.innerHTML = `
      <div role="dialog">
        Ada Lovelace
        <div class="thread">Hello world</div>
        <div contenteditable="true"></div>
      </div>
    `;

    const text = await composeDialogText(fakePage);
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("Hello world");
  });

  it("leaves deeply nested textbox text out of a shadow-root dialog", async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.querySelector("#host")!;
    host.attachShadow({ mode: "open" }).innerHTML = `
      <div role="dialog">
        Write to Ada
        <div role="textbox"><span>Hello <b>world</b></span></div>
      </div>
    `;

    await expect(composeDialogText(fakePage)).resolves.toBe("Write to Ada");
  });
});
