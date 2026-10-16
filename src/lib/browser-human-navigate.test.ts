import { afterEach, describe, expect, it, vi } from "vitest";

import { humanNavigate } from "@/lib/browser";

afterEach(() => {
  globalThis.__crewBrowser = undefined;
  globalThis.__crewBrowserLock = undefined;
});

describe("humanNavigate", () => {
  it("navigates a shared page while the session is in human mode", async () => {
    const goto = vi.fn();
    const waitForTimeout = vi.fn();
    globalThis.__crewBrowser = {
      context: {},
      page: {
        goto,
        waitForTimeout,
        url: () => "https://linkedin.com/login",
        title: async () => "LinkedIn",
        isClosed: () => false,
      },
      mode: "human",
      takeoverReason: "Sign in",
      lastSnapshot: [],
      lastShot: null,
    } as unknown as NonNullable<typeof globalThis.__crewBrowser>;

    const status = await humanNavigate("linkedin.com/login");

    expect(goto).toHaveBeenCalledWith("https://linkedin.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    expect(waitForTimeout).toHaveBeenCalledWith(400);
    expect(status).toMatchObject({ running: true, mode: "human" });
  });
});
