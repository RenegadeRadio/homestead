import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));
const handleUserMessage = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) => fn(state.store)),
}));
vi.mock("@/lib/agent/run", () => ({ handleUserMessage }));

import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { startNextOutboxItem } from "@/lib/outbox-bot";
import { createSeedStore } from "@/lib/seed";

describe("Outbox Bot one-approval instructions", () => {
  beforeEach(() => {
    state.store = createSeedStore();
    state.store.settings.linkedinSendWindowEnd = state.store.settings.linkedinSendWindowStart = "09:00";
    vi.clearAllMocks();
  });

  it.each(["message", "invite"] as const)("uses the typing approval instruction for %s", async (kind) => {
    const item = createOutboxItem(state.store, {
      name: "Ada Lovelace",
      profileUrl: "https://www.linkedin.com/in/ada-lovelace",
      text: "Hello Ada",
      kind,
      createdBy: "operator",
    });
    approveOutboxItems(state.store, { ids: [item.id] });

    await startNextOutboxItem();

    const text = (handleUserMessage.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(text).toContain("The operator approves once, when you type the text.");
    expect(text).not.toContain("Stop for the operator's approval before Send.");
  });

  it("tells the Bot an invite's exact text was already approved when enabled", async () => {
    state.store.settings.outboxSendWithoutFinalApproval = true;
    const item = createOutboxItem(state.store, {
      name: "Ada Lovelace",
      profileUrl: "https://www.linkedin.com/in/ada-lovelace",
      text: "Hello Ada",
      kind: "invite",
      createdBy: "operator",
    });
    approveOutboxItems(state.store, { ids: [item.id] });

    await startNextOutboxItem();

    const text = (handleUserMessage.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(text).toContain("The operator already approved this exact text in the Outbox");
    expect(text).not.toContain("The operator approves once");
  });
});
