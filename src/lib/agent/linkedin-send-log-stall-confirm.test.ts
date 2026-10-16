import { afterEach, describe, expect, it, vi } from "vitest";

import { recordLinkedInSend } from "@/lib/agent/linkedin-send-log";
import { formatSnapshot, type SnapshotEl } from "@/lib/browser";
import { createSeedStore } from "@/lib/seed";
import type { OutboxItem } from "@/lib/types";

const facts = {
  botId: "bot_test",
  conversationId: "conv_test",
  messageId: "msg_test",
};

function snapshotLabel(url: string, text: string, ref: number) {
  const element: SnapshotEl = { ref, tag: "button", role: "button", text, x: 0, y: 0 };
  return formatSnapshot(url, "Profile | LinkedIn", [element])
    .split("\n")
    .find((line) => line.startsWith(`[${ref}]`))!;
}

function setup() {
  vi.useFakeTimers();
  vi.setSystemTime("2026-09-19T13:44:15.000Z");
  const store = createSeedStore();
  const profileUrl = "https://www.linkedin.com/in/amber-michelle/";
  const item: OutboxItem = {
    id: "outbox_mary",
    name: "Mary Somerville S.",
    profileUrl,
    text: "Hello Mary",
    kind: "invite",
    status: "sending",
    sendingAt: "2026-09-19T13:40:47.000Z",
    createdAt: "2026-09-19T13:30:00.000Z",
    createdBy: store.bots[0].id,
  };
  (store.outbox ??= []).push(item);
  recordLinkedInSend(store, {
    ...facts,
    url: profileUrl,
    action: "click",
    label: snapshotLabel(profileUrl, "Connect", 3),
  });
  vi.setSystemTime("2026-09-19T14:05:15.000Z");
  return { store, item, profileUrl };
}

describe("LinkedIn delayed invitation confirmation", () => {
  afterEach(() => vi.useRealTimers());

  it("finishes the matching sending invite after 21 minutes", () => {
    const { store, item, profileUrl } = setup();
    const entry = recordLinkedInSend(store, {
      ...facts,
      url: profileUrl,
      action: "click",
      label: snapshotLabel(profileUrl, "Send invitation", 4),
    });

    expect(item.status).toBe("sent");
    expect(item.sentAt).toBe(entry.at);
    expect(entry.outboxItemId).toBe(item.id);
  });

  it("does not finish the invite for another Connect click", () => {
    const { store, item, profileUrl } = setup();
    const entry = recordLinkedInSend(store, {
      ...facts,
      url: profileUrl,
      action: "click",
      label: snapshotLabel(profileUrl, "Connect", 3),
    });

    expect(item.status).toBe("sending");
    expect(entry.outboxItemId).toBeUndefined();
  });

  it("does not finish a sending invite for a different profile", () => {
    const { store, item } = setup();
    const otherUrl = "https://www.linkedin.com/in/different-profile/";
    const entry = recordLinkedInSend(store, {
      ...facts,
      url: otherUrl,
      action: "click",
      label: snapshotLabel(otherUrl, "Send invitation", 4),
    });

    expect(item.status).toBe("sending");
    expect(item.sentAt).toBeUndefined();
    expect(entry.outboxItemId).toBeUndefined();
  });
});
