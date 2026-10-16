import { describe, expect, it } from "vitest";

import { createOutboxItem, updateOutboxItem } from "@/lib/outbox";
import { createSeedStore } from "@/lib/seed";

describe("outbox invite note variants", () => {
  it("classifies invite drafts after creation and editing but not messages", () => {
    const store = createSeedStore();
    const invite = createOutboxItem(store, {
      name: "Invite",
      profileUrl: "https://www.linkedin.com/in/invite/",
      text: "Hello, I build AI tools for businesses",
      kind: "invite",
      lane: "A",
      createdBy: "operator",
    });
    expect(invite.noteVariant).toBe("a-ai-tools");

    updateOutboxItem(store, { id: invite.id, text: "Would you like one free app?" });
    expect(invite.noteVariant).toBe("a-one-free-app");

    const message = createOutboxItem(store, {
      name: "Message",
      profileUrl: "https://www.linkedin.com/in/message/",
      text: "I build AI tools for businesses",
      kind: "message",
      lane: "A",
      createdBy: "operator",
    });
    expect(message.noteVariant).toBeUndefined();
  });
});
