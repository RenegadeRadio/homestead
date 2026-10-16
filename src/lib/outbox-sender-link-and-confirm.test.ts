import { beforeEach, describe, expect, it, vi } from "vitest";

import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { sendOutboxItem, type SendOutboxDeps } from "@/lib/outbox-sender";
import { createSeedStore } from "@/lib/seed";
import type { Store } from "@/lib/types";

let store: Store;

function approved() {
  const item = createOutboxItem(store, {
    name: "Ada",
    profileUrl: "https://www.linkedin.com/in/ada",
    text: "Hello Ada",
    createdBy: "operator",
  });
  approveOutboxItems(store, { ids: [item.id] });
  return item;
}

function deps(overrides: Partial<SendOutboxDeps> = {}): SendOutboxDeps {
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
    pageText: vi.fn(async () => "No confirmation"),
    setMode: vi.fn(async () => undefined),
    now: () => new Date("2026-09-18T10:00:00.000Z"),
    sleep: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("outbox LinkedIn controls and confirmation", () => {
  beforeEach(() => {
    store = createSeedStore();
  });

  it("clicks an anchor Message control", async () => {
    const item = approved();
    const fake = deps({
      snapshotElements: vi.fn(async () => [
        { ref: 7, tag: "a", role: "a", text: "Message" },
      ]),
    });

    await sendOutboxItem(store, item, fake);

    expect(fake.click).toHaveBeenCalledWith(7);
  });

  it("confirms the send from compose text instead of page text", async () => {
    const item = approved();
    const fake = deps();

    await sendOutboxItem(store, item, fake);

    expect(item.status).toBe("sent");
    expect(fake.pageText).not.toHaveBeenCalled();
  });
});
