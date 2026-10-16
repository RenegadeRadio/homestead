import { describe, expect, it } from "vitest";

import { executeTool } from "@/lib/agent/execute";
import { recordLinkedInSend } from "@/lib/agent/linkedin-send-log";
import { createSeedStore } from "@/lib/seed";
import { createOutboxItem, failOutboxItem } from "@/lib/outbox";

describe("new outbox flow", () => {
  it("copies a matched sending item's id and lane to its send entry", () => {
    const store = createSeedStore();
    const item = createOutboxItem(store, {
      name: "Ada",
      profileUrl: "https://www.linkedin.com/in/ada",
      text: "Hello Ada",
      lane: "A",
      createdBy: "operator",
    });
    item.status = "sending";

    const entry = recordLinkedInSend(store, {
      botId: store.bots[0].id,
      conversationId: store.conversations[0].id,
      messageId: "msg",
      url: item.profileUrl,
      action: "type",
      text: item.text,
    });

    expect(item.status).toBe("sent");
    expect(entry).toMatchObject({ outboxItemId: item.id, lane: "A" });
  });

  it("leaves a sending item unchanged for a different profile slug", () => {
    const store = createSeedStore();
    const item = createOutboxItem(store, {
      name: "Ada",
      profileUrl: "https://www.linkedin.com/in/ada",
      text: "Hello Ada",
      createdBy: "operator",
    });
    item.status = "sending";

    recordLinkedInSend(store, {
      botId: store.bots[0].id,
      conversationId: store.conversations[0].id,
      messageId: "msg",
      url: "https://www.linkedin.com/in/bea",
      action: "type",
      text: "Hello Bea",
    });

    expect(item.status).toBe("sending");
  });

  it("stores lane B from queue_linkedin_message", async () => {
    const store = createSeedStore();
    const bot = store.bots[0];

    await executeTool(
      "queue_linkedin_message",
      {
        name: "Ada",
        profileUrl: "https://www.linkedin.com/in/ada",
        text: "Hello Ada",
        lane: "B",
      },
      {
        store,
        bot,
        conversationId: store.conversations[0].id,
        messageId: store.messages[0].id,
      }
    );

    expect(store.outbox?.[0].lane).toBe("B");
  });

  it("lets the operator fail a sending item", () => {
    const store = createSeedStore();
    const item = createOutboxItem(store, {
      name: "Ada",
      profileUrl: "https://www.linkedin.com/in/ada",
      text: "Hello Ada",
      createdBy: "operator",
    });
    item.status = "sending";

    failOutboxItem(store, { id: item.id });

    expect(item).toMatchObject({ status: "failed", error: "Stopped by the operator." });
  });
});
