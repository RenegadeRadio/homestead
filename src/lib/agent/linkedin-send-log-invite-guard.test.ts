import { describe, expect, it } from "vitest";

import { recordLinkedInSend } from "@/lib/agent/linkedin-send-log";
import { createSeedStore } from "@/lib/seed";

describe("LinkedIn message Outbox matching", () => {
  it("does not mark a sending invite as sent for a message click", () => {
    const store = createSeedStore();
    const profileUrl = "https://www.linkedin.com/in/jane-doe-123/";
    const item = {
      id: "outbox_invite_jane",
      name: "Jane Doe",
      profileUrl,
      text: "Hello Jane",
      kind: "invite" as const,
      status: "sending" as const,
      createdAt: "2026-09-16T09:00:00.000Z",
      createdBy: store.bots[0].id,
    };
    (store.outbox ??= []).push(item);

    const entry = recordLinkedInSend(store, {
      botId: store.bots[0].id,
      conversationId: store.conversations[0].id,
      messageId: store.messages[0].id,
      url: profileUrl,
      action: "click",
      label: "Send",
    });

    expect(entry.kind).toBe("message");
    expect(item.status).toBe("sending");
    expect(item).not.toHaveProperty("sentAt");
  });
});
