import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) =>
    fn(state.store)
  ),
}));
vi.mock("@/lib/crm/notion-sync", () => ({ syncPendingSends: vi.fn() }));

import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { runOutbox, sendOutboxItem, type SendOutboxDeps } from "@/lib/outbox-sender";
import { createSeedStore } from "@/lib/seed";
import type { OutboxItem } from "@/lib/types";

function approved(name = "Ada", slug = "ada") {
  const item = createOutboxItem(state.store, {
    name,
    profileUrl: `https://www.linkedin.com/in/${slug}`,
    text: `Hello ${name}`,
    createdBy: "operator",
  });
  approveOutboxItems(state.store, { ids: [item.id] });
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
    composeText: vi.fn(async () => "Hello Ada Hello Bea"),
    pageText: vi.fn(async () => "Hello Ada Hello Bea"),
    setMode: vi.fn(async () => undefined),
    now: () => new Date("2026-09-17T10:00:00.000Z"),
    sleep: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("outbox sender", () => {
  beforeEach(() => {
    state.store = createSeedStore();
    globalThis.__crewOutboxRunning = false;
    vi.clearAllMocks();
  });

  it("sends the exact approved text and records the LinkedIn message", async () => {
    const item = approved();
    const fake = deps();

    await sendOutboxItem(state.store, item, fake);

    expect(fake.navigate).toHaveBeenCalledWith(item.profileUrl);
    expect(fake.type).toHaveBeenCalledWith(2, item.text);
    expect(fake.click).toHaveBeenNthCalledWith(1, 1);
    expect(fake.click).toHaveBeenNthCalledWith(2, 3);
    expect(item.status).toBe("sent");
    expect(state.store.linkedinSendLog).toHaveLength(1);
    expect(state.store.linkedinSendLog?.[0]).toMatchObject({
      kind: "message",
      slug: "ada",
      text: item.text,
    });
  });

  it("returns stale approved text to draft without browser work", async () => {
    const item = approved();
    item.text = "Changed after approval";
    const fake = deps();

    await sendOutboxItem(state.store, item, fake);

    expect(item.status).toBe("draft");
    expect(fake.navigate).not.toHaveBeenCalled();
    expect(fake.type).not.toHaveBeenCalled();
  });

  it("fails without clicking when the profile has no Message button", async () => {
    const item = approved();
    const fake = deps({ snapshotElements: vi.fn(async () => []) });

    await sendOutboxItem(state.store, item, fake);

    expect(item).toMatchObject({
      status: "failed",
      error: "No Message button on the profile.",
    });
    expect(fake.click).not.toHaveBeenCalled();
  });

  it("does not record a send that cannot be confirmed", async () => {
    const item = approved();
    const fake = deps({ composeText: vi.fn(async () => "Ada") });

    await sendOutboxItem(state.store, item, fake);

    expect(item).toMatchObject({
      status: "failed",
      error: "Send not confirmed. Check LinkedIn before retrying.",
    });
    expect(state.store.linkedinSendLog ?? []).toEqual([]);
  });

  it("stops before the second profile when the first item fails", async () => {
    const first = approved("Ada", "ada");
    const second = approved("Bea", "bea");
    const fake = deps({ snapshotElements: vi.fn(async () => []) });

    await runOutbox(fake);

    expect(first.status).toBe("failed");
    expect(second.status).toBe("approved");
    expect(fake.navigate).toHaveBeenCalledTimes(1);
    expect(fake.navigate).not.toHaveBeenCalledWith(second.profileUrl);
  });

  it("waits for pacing before sending the second item", async () => {
    approved("Ada", "ada");
    approved("Bea", "bea");
    state.store.settings.linkedinGapSeconds = 300;
    const snapshots = [
      "Message", "textbox", "Send", "Message", "textbox", "Send",
    ];
    const fake = deps({
      snapshotElements: vi.fn(async () => {
        const next = snapshots.shift();
        if (next === "Message") return [{ ref: 1, tag: "button", role: "button", text: next }];
        if (next === "textbox") return [{ ref: 2, tag: "div", role: next, text: "" }];
        return [{ ref: 3, tag: "button", role: "button", text: next ?? "" }];
      }),
    });

    await runOutbox(fake);

    expect(fake.navigate).toHaveBeenCalledTimes(2);
    expect(fake.sleep).toHaveBeenCalledWith(300_000);
    expect(state.store.outbox?.map((item: OutboxItem) => item.status)).toEqual(["sent", "sent"]);
  });
});
