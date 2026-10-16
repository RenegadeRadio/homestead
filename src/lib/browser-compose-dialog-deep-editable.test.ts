import { createRequire } from "node:module";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { composeDialogText } from "@/lib/browser";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

describe("composeDialogText deeply nested editable", () => {
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

  it("excludes editable text seven levels below a shadow-root dialog", async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.querySelector("#host")!;
    host.attachShadow({ mode: "open" }).innerHTML = `
      <div role="dialog">
        <header>Edith Clarke</header>
        <div>
          <div>
            <div>
              <div>
                <div>
                  <div>
                    <div role="textbox" contenteditable="true">
                      <p>unsent draft</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const text = await composeDialogText(fakePage);
    expect(text).toContain("Edith Clarke");
    expect(text).not.toContain("unsent draft");
  });
});
