import { createRequire } from "node:module";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { composeDialogText } from "@/lib/browser";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

describe("composeDialogText", () => {
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

  it("returns collapsed text from the one dialog with a contenteditable field", async () => {
    document.body.innerHTML = `
      <div role="dialog">
        Write to   Ada
        <div contenteditable="true"> Hello\n world </div>
      </div>
      <div role="dialog">Unrelated dialog</div>
    `;

    await expect(composeDialogText(fakePage)).resolves.toBe("Write to Ada");
  });

  it("returns null when two dialogs contain editable fields", async () => {
    document.body.innerHTML = `
      <div role="dialog"><textarea></textarea></div>
      <div role="dialog"><div role="textbox"></div></div>
    `;

    await expect(composeDialogText(fakePage)).resolves.toBeNull();
  });

  it("returns null when no dialog contains an editable field", async () => {
    document.body.innerHTML = '<div role="dialog">No editor</div>';

    await expect(composeDialogText(fakePage)).resolves.toBeNull();
  });
});
