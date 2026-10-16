import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) => fn(state.store)),
}));
vi.mock("@/lib/agent/run", () => ({ handleUserMessage: vi.fn(async () => {}) }));

import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { startOutboxRun, stopOutboxRun } from "@/lib/outbox-bot";
import { createSeedStore } from "@/lib/seed";
import type { LinkedInSendEntry } from "@/lib/types";

const NOW = new Date("2026-09-25T13:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

function sendEntry(hoursAgo: number, index: number): LinkedInSendEntry {
  return {
    id: `send-invite-${hoursAgo}-${index}`,
    at: new Date(NOW.getTime() - hoursAgo * HOUR_MS).toISOString(),
    botId: "bot",
    conversationId: "conversation",
    messageId: "message",
    url: "https://www.linkedin.com/in/test",
    slug: "test",
    action: "click",
    label: '[1] button "Send"',
    key: null,
    text: null,
    kind: "invite",
  };
}

function createApprovedInviteThenMessage() {
  const invite = createOutboxItem(state.store, {
    name: "Grace",
    profileUrl: "https://www.linkedin.com/in/grace",
    text: "Hello Grace",
    kind: "invite",
    lane: "B",
    createdBy: "operator",
  });
  approveOutboxItems(state.store, { ids: [invite.id] });

  vi.setSystemTime(new Date(NOW.getTime() + 1000));
  const message = createOutboxItem(state.store, {
    name: "Ada",
    profileUrl: "https://www.linkedin.com/in/ada",
    text: "Hello Ada",
    lane: "B",
    createdBy: "operator",
  });
  approveOutboxItems(state.store, { ids: [message.id] });
  return { invite, message };
}

describe("Outbox message fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    state.store = createSeedStore();
  });

  afterEach(() => {
    stopOutboxRun();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("falls back to an approved message when the weekly invite cap refuses the invite", async () => {
    const { invite, message } = createApprovedInviteThenMessage();
    state.store.linkedinSendLog = Array.from(
      { length: 35 },
      (_, index) => sendEntry((index + 1) * 4, index)
    );

    const result = await startOutboxRun();

    expect(result.started).toBe(true);
    expect(message.status).toBe("sending");
    expect(invite.status).toBe("approved");
  });

  it("falls back to an approved message when an invite pause is in force", async () => {
    const { invite, message } = createApprovedInviteThenMessage();
    state.store.settings.linkedinInvitesPausedUntil = new Date(
      NOW.getTime() + 24 * HOUR_MS
    ).toISOString();

    const result = await startOutboxRun();

    expect(result.started).toBe(true);
    expect(message.status).toBe("sending");
    expect(invite.status).toBe("approved");
  });
});
