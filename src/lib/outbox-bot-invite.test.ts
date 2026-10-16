import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));
const handleUserMessage = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) =>
    fn(state.store)
  ),
}));
vi.mock("@/lib/agent/run", () => ({ handleUserMessage }));

import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { startNextOutboxItem } from "@/lib/outbox-bot";
import { createSeedStore } from "@/lib/seed";

describe("invite Outbox Bot instructions", () => {
  beforeEach(() => {
    state.store = createSeedStore();
    state.store.settings.linkedinSendWindowEnd = state.store.settings.linkedinSendWindowStart = "09:00";
    vi.clearAllMocks();
  });

  it("starts an invite turn with the required recipient and note instructions", async () => {
    const item = createOutboxItem(state.store, {
      name: "Ada Lovelace",
      profileUrl: "https://www.linkedin.com/in/ada-lovelace",
      text: "I enjoyed your work on the analytical engine.",
      kind: "invite",
      createdBy: "operator",
    });
    approveOutboxItems(state.store, { ids: [item.id] });

    await expect(startNextOutboxItem()).resolves.toEqual({ started: true, itemId: item.id });

    const text = (handleUserMessage.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(text).toContain("Connect");
    expect(text).toContain("Add a note");
    expect(text).toContain(item.name);
    expect(text).toContain(`"${item.text}"`);
  });
});
