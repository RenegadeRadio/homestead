import { beforeEach, describe, expect, it, vi } from "vitest";

import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { sendOutboxItem, type SendOutboxDeps } from "@/lib/outbox-sender";
import { createSeedStore } from "@/lib/seed";
import type { Store } from "@/lib/types";

let store: Store;

function approved(name = "Ada", slug = "ada") {
  const item = createOutboxItem(store, {
    name,
    profileUrl: `https://www.linkedin.com/in/${slug}`,
    text: `Hello ${name}`,
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
    composeText: vi.fn(async () => "Write to Ada"),
    pageText: vi.fn(async () => "Hello Ada"),
    setMode: vi.fn(async () => undefined),
    now: () => new Date("2026-09-17T10:00:00.000Z"),
    sleep: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("outbox compose recipient check", () => {
  beforeEach(() => {
    store = createSeedStore();
  });

  it("fails before typing when the compose dialog names someone else", async () => {
    const item = approved();
    const fake = deps({
      composeText: vi.fn(async () => "Write to Bea"),
      pageText: vi.fn(async () => "Ada is on this profile page"),
    });

    await sendOutboxItem(store, item, fake);

    expect(item).toMatchObject({
      status: "failed",
      error: "Compose box does not name Ada. Nothing was typed.",
    });
    expect(fake.type).not.toHaveBeenCalled();
  });

  it("fails before typing when there is no single compose dialog", async () => {
    const item = approved();
    const fake = deps({ composeText: vi.fn(async () => null) });

    await sendOutboxItem(store, item, fake);

    expect(item).toMatchObject({
      status: "failed",
      error: "No single compose dialog found. Nothing was typed.",
    });
    expect(fake.type).not.toHaveBeenCalled();
  });

  it("clicks the matching Message button with the lowest ref", async () => {
    const item = approved();
    const snapshots = [
      [
        { ref: 40, tag: "button", role: "button", text: "Message" },
        { ref: 12, tag: "button", role: "button", text: "Message" },
      ],
      [{ ref: 2, tag: "div", role: "textbox", text: "" }],
      [{ ref: 3, tag: "button", role: "button", text: "Send" }],
    ];
    const fake = deps({ snapshotElements: vi.fn(async () => snapshots.shift() ?? []) });

    await sendOutboxItem(store, item, fake);

    expect(fake.click).toHaveBeenNthCalledWith(1, 12);
  });
});
