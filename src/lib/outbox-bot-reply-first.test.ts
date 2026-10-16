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
import type { OutboxItem } from "@/lib/types";

function createApprovedItem(
  input: Pick<OutboxItem, "name" | "profileUrl" | "text" | "createdBy" | "lane" | "kind">,
  createdAt: string
) {
  const item = createOutboxItem(state.store, input);
  approveOutboxItems(state.store, { ids: [item.id] });
  item.createdAt = createdAt;
  return item;
}

describe("Outbox reply priority", () => {
  beforeEach(() => {
    state.store = createSeedStore();
    state.store.settings.linkedinSendWindowEnd = state.store.settings.linkedinSendWindowStart = "09:00";
    vi.clearAllMocks();
  });

  it("starts an approved no-lane message before older outreach", async () => {
    const invite = createApprovedItem({
      name: "Early Invite",
      profileUrl: "https://www.linkedin.com/in/early-invite",
      text: "Hello from the invite queue",
      kind: "invite",
      createdBy: "operator",
    }, "2026-09-22T09:00:00.000Z");
    const lanedMessage = createApprovedItem({
      name: "Laned Message",
      profileUrl: "https://www.linkedin.com/in/laned-message",
      text: "Hello from outreach",
      lane: "A",
      createdBy: "operator",
    }, "2026-09-22T10:00:00.000Z");
    const reply = createApprovedItem({
      name: "Reply",
      profileUrl: "https://www.linkedin.com/in/reply",
      text: "Thanks for getting back to me",
      createdBy: "operator",
    }, "2026-09-22T11:00:00.000Z");

    await expect(startNextOutboxItem()).resolves.toEqual({ started: true, itemId: reply.id });
    expect(reply.status).toBe("sending");
    expect(invite.status).toBe("approved");
    expect(lanedMessage.status).toBe("approved");
  });

  it("starts the earliest approved item when there are no replies", async () => {
    const latestInvite = createApprovedItem({
      name: "Latest Invite",
      profileUrl: "https://www.linkedin.com/in/latest-invite",
      text: "Hello latest",
      kind: "invite",
      createdBy: "operator",
    }, "2026-09-22T11:00:00.000Z");
    const lanedMessage = createApprovedItem({
      name: "Laned Message",
      profileUrl: "https://www.linkedin.com/in/laned-message",
      text: "Hello from outreach",
      lane: "B",
      createdBy: "operator",
    }, "2026-09-22T10:00:00.000Z");
    const earliestInvite = createApprovedItem({
      name: "Earliest Invite",
      profileUrl: "https://www.linkedin.com/in/earliest-invite",
      text: "Hello earliest",
      kind: "invite",
      createdBy: "operator",
    }, "2026-09-22T09:00:00.000Z");

    await expect(startNextOutboxItem()).resolves.toEqual({
      started: true,
      itemId: earliestInvite.id,
    });
    expect(earliestInvite.status).toBe("sending");
    expect(latestInvite.status).toBe("approved");
    expect(lanedMessage.status).toBe("approved");
  });
});
