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

describe("startNextOutboxItem", () => {
  beforeEach(() => {
    state.store = createSeedStore();
    state.store.settings.linkedinSendWindowEnd = state.store.settings.linkedinSendWindowStart = "09:00";
    vi.clearAllMocks();
  });

  it("marks the earliest approved item sending and starts its Bot conversation", async () => {
    const item = approved();

    await expect(startNextOutboxItem()).resolves.toEqual({ started: true, itemId: item.id });

    expect(item.status).toBe("sending");
    expect(item.sendingAt).toBeTruthy();
    expect(handleUserMessage).toHaveBeenCalledOnce();
    const firstBot = state.store.bots.find((bot) => !bot.archived)!;
    const directConversation = state.store.conversations.find(
      (conversation) =>
        conversation.kind === "dm" &&
        conversation.botIds.length === 1 &&
        conversation.botIds[0] === firstBot.id
    )!;
    expect(handleUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: directConversation.id,
        text: expect.stringContaining(item.profileUrl),
      })
    );
    const message = (handleUserMessage.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(message).toContain(item.name);
    expect(message).toContain(item.text);
  });

  it("refuses while an item is already sending", async () => {
    const item = approved();
    item.status = "sending";

    await expect(startNextOutboxItem()).resolves.toEqual({
      started: false,
      reason: "An item is already sending.",
    });
    expect(handleUserMessage).not.toHaveBeenCalled();
  });

  it("refuses inside the LinkedIn pacing gap", async () => {
    approved();
    state.store.settings.linkedinLastActionAt = new Date().toISOString();

    const result = await startNextOutboxItem();

    expect(result).toMatchObject({ started: false });
    expect(result.started === false && result.reason).toMatch(/^LinkedIn pacing:/);
    expect(handleUserMessage).not.toHaveBeenCalled();
  });
});
