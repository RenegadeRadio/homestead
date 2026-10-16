import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) => fn(state.store)),
}));
vi.mock("@/lib/agent/run", () => ({ handleUserMessage: vi.fn(async () => {}) }));

import {
  checkLinkedInWeeklyInviteCap,
  countLinkedInInvitesLast7Days,
} from "@/lib/agent/linkedin-budget";
import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { startOutboxRun, stopOutboxRun } from "@/lib/outbox-bot";
import { createSeedStore } from "@/lib/seed";
import type { LinkedInSendEntry } from "@/lib/types";

const NOW = new Date("2026-09-25T13:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

function sendEntry(
  hoursAgo: number,
  kind: "invite" | "message" = "invite",
  index = 0
): LinkedInSendEntry {
  return {
    id: `send-${kind}-${hoursAgo}-${index}`,
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
    kind,
  };
}

describe("LinkedIn weekly invite cap", () => {
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

  it("counts counted invites from the last 168 hours only", () => {
    const log = [sendEntry(1), sendEntry(167.9), sendEntry(169), sendEntry(2, "message")];
    expect(countLinkedInInvitesLast7Days(NOW, log)).toBe(2);
  });

  it("allows 34 invites and refuses 35 until the oldest leaves the window", () => {
    const thirtyFour = Array.from({ length: 34 }, (_, index) => sendEntry(index + 1, "invite", index));
    expect(checkLinkedInWeeklyInviteCap(NOW, thirtyFour, 35)).toEqual({ status: "allowed" });

    const thirtyFive = [...thirtyFour, sendEntry(100, "invite", 34)];
    const decision = checkLinkedInWeeklyInviteCap(NOW, thirtyFive, 35);
    expect(decision.status).toBe("refused");
    expect(decision.status === "refused" && decision.nextAllowedAt.toISOString()).toBe(
      new Date(NOW.getTime() - 100 * HOUR_MS + 7 * 24 * HOUR_MS).toISOString()
    );
    expect(decision.status === "refused" && decision.message).toContain("weekly invite cap");
  });

  it("allows any count when the cap is zero", () => {
    const log = Array.from({ length: 100 }, (_, index) => sendEntry(index + 0.5, "invite", index));
    expect(checkLinkedInWeeklyInviteCap(NOW, log, 0)).toEqual({ status: "allowed" });
  });

  it("does not start an approved invite at the weekly cap", async () => {
    const item = createOutboxItem(state.store, {
      name: "Grace",
      profileUrl: "https://www.linkedin.com/in/grace",
      text: "Hello Grace",
      kind: "invite",
      createdBy: "operator",
    });
    approveOutboxItems(state.store, { ids: [item.id] });
    state.store.linkedinSendLog = Array.from(
      { length: 35 },
      (_, index) => sendEntry((index + 1) * 4, "invite", index)
    );

    const result = await startOutboxRun();

    expect(result.started).toBe(false);
    expect(result.started === false && result.reason).toContain("weekly invite cap");
    expect(item.status).toBe("approved");
  });

  it("still starts an approved message at the weekly invite cap", async () => {
    const item = createOutboxItem(state.store, {
      name: "Ada",
      profileUrl: "https://www.linkedin.com/in/ada",
      text: "Hello Ada",
      createdBy: "operator",
    });
    approveOutboxItems(state.store, { ids: [item.id] });
    state.store.linkedinSendLog = Array.from(
      { length: 35 },
      (_, index) => sendEntry((index + 1) * 4, "invite", index)
    );

    const result = await startOutboxRun();

    expect(result.started).toBe(true);
    expect(item.status).toBe("sending");
  });
});
