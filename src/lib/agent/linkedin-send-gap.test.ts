import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) =>
    fn(state.store)
  ),
}));
vi.mock("@/lib/crm/notion-sync", () => ({ syncPendingSends: vi.fn() }));

import {
  drawLinkedInSendGapSeconds,
  linkedInSendGapSeconds,
} from "@/lib/agent/linkedin-pacing";
import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { sendOutboxItem, type SendOutboxDeps } from "@/lib/outbox-sender";
import { createSeedStore } from "@/lib/seed";

function approved() {
  const item = createOutboxItem(state.store, {
    name: "Ada",
    profileUrl: "https://www.linkedin.com/in/ada",
    text: "Hello Ada",
    createdBy: "operator",
  });
  approveOutboxItems(state.store, { ids: [item.id] });
  return item;
}

function deps(): SendOutboxDeps {
  const snapshots = [
    [{ ref: 1, tag: "button", role: "button", text: "Message" }],
    [{ ref: 2, tag: "div", role: "textbox", text: "" }],
    [{ ref: 3, tag: "button", role: "button", text: "Send" }],
  ];
  return {
    navigate: vi.fn(async () => ({ gate: { needed: false, reason: "" } })),
    snapshotElements: vi.fn(async () => snapshots.shift() ?? []),
    click: vi.fn(async () => undefined),
    type: vi.fn(async () => undefined),
    composeText: vi.fn(async () => "Hello Ada"),
    pageText: vi.fn(async () => "Hello Ada"),
    setMode: vi.fn(async () => undefined),
    now: () => new Date("2026-09-17T10:00:00.000Z"),
    sleep: vi.fn(async () => undefined),
  };
}

describe("LinkedIn send gap", () => {
  it("draws a whole-number gap from the configured half-open range", () => {
    const settings = { linkedinGapSeconds: 1200, linkedinGapMaxSeconds: 1800 };
    expect(drawLinkedInSendGapSeconds(settings, () => 0)).toBe(1200);
    expect(drawLinkedInSendGapSeconds(settings, () => 0.5)).toBe(1500);

    const high = drawLinkedInSendGapSeconds(settings, () => 0.999);
    expect(high).toBeGreaterThanOrEqual(1200);
    expect(high).toBeLessThan(1800);
  });

  it("does not draw without a maximum greater than the minimum", () => {
    expect(drawLinkedInSendGapSeconds({ linkedinGapSeconds: 1200 })).toBeUndefined();
    expect(drawLinkedInSendGapSeconds({ linkedinGapSeconds: 1200, linkedinGapMaxSeconds: 1200 })).toBeUndefined();
    expect(drawLinkedInSendGapSeconds({ linkedinGapSeconds: 1200, linkedinGapMaxSeconds: 900 })).toBeUndefined();
  });

  it("uses only a drawn gap above the minimum", () => {
    expect(linkedInSendGapSeconds({ linkedinGapSeconds: 1200, linkedinSendGapSeconds: 1500 })).toBe(1500);
    expect(linkedInSendGapSeconds({ linkedinGapSeconds: 1200, linkedinSendGapSeconds: 900 })).toBe(1200);
    expect(linkedInSendGapSeconds({})).toBe(2700);
  });

  describe("after an Outbox send", () => {
    beforeEach(() => {
      state.store = createSeedStore();
      state.store.settings.linkedinGapSeconds = 1200;
      state.store.settings.linkedinGapMaxSeconds = 1800;
      vi.clearAllMocks();
    });

    it("stores a newly drawn whole-number gap", async () => {
      await sendOutboxItem(state.store, approved(), deps());

      const gap = state.store.settings.linkedinSendGapSeconds;
      expect(Number.isInteger(gap)).toBe(true);
      expect(gap).toBeGreaterThanOrEqual(1200);
      expect(gap).toBeLessThanOrEqual(1800);
    });
  });
});
