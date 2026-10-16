import { describe, expect, it, vi } from "vitest";

import {
  closeLeftoverLinkedInConversations,
  type LeftoverDeps,
} from "@/lib/outbox-leftovers";

describe("closeLeftoverLinkedInConversations", () => {
  it("closes conversation windows from fresh snapshots without closing drafts", async () => {
    const first = "Close your conversation with Ada Lovelace";
    const second = "Close your conversation with Grace Hopper";
    const draft = "Close your draft conversation";
    const snapshots = [
      [
        { ref: 1, text: first },
        { ref: 2, text: second },
        { ref: 3, text: draft },
        { ref: 4, text: "Open settings" },
      ],
      [
        { ref: 20, text: second },
        { ref: 30, text: draft },
      ],
      [{ ref: 300, text: draft }],
    ];
    const click = vi.fn(async () => ({ blocked: false }));
    const deps: LeftoverDeps = {
      status: vi.fn(async () => ({ running: true, url: "https://www.linkedin.com/feed/" })),
      elements: vi.fn(async () => snapshots.shift() ?? []),
      click,
    };

    await expect(closeLeftoverLinkedInConversations(deps)).resolves.toEqual([first, second]);
    expect(click.mock.calls).toEqual([[1], [20]]);
  });

  it.each([
    { running: false, url: "" },
    { running: true, url: "https://example.com/" },
  ])("does nothing when the browser is unavailable or off LinkedIn", async (status) => {
    const elements = vi.fn(async () => [{ ref: 1, text: "Close your conversation with Ada" }]);
    const click = vi.fn(async () => undefined);

    await expect(closeLeftoverLinkedInConversations({
      status: vi.fn(async () => status),
      elements,
      click,
    })).resolves.toEqual([]);
    expect(elements).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
});
