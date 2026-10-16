import { describe, expect, it } from "vitest";

import { recordLinkedInSend } from "@/lib/agent/linkedin-send-log";
import { createSeedStore } from "@/lib/seed";
import type { CrmProspectStatus } from "@/lib/types";

function storeWithProspect(status: CrmProspectStatus) {
  const store = createSeedStore();
  store.crmProspects = [
    {
      id: "prospect_1",
      at: "2026-09-23T10:00:00.000Z",
      botId: "bot_1",
      name: "Jane Doe",
      profileUrl: "https://www.linkedin.com/in/jane-doe/",
      slug: "jane-doe",
      lane: "B",
      source: "linkedin",
      status,
      note: "Research.",
    },
  ];
  return store;
}

const facts = {
  botId: "bot_1",
  conversationId: "conversation_1",
  messageId: "message_1",
  url: "https://www.linkedin.com/in/jane-doe/",
  action: "click" as const,
};

describe("LinkedIn send log prospect status", () => {
  it("moves a confirmed invite to pending but ignores a Connect click", () => {
    const sent = storeWithProspect("queued");
    recordLinkedInSend(sent, { ...facts, label: '[1] button "Send invitation"' });
    expect(sent.crmProspects?.[0].status).toBe("pending");

    const clicked = storeWithProspect("queued");
    recordLinkedInSend(clicked, { ...facts, label: '[1] button "Connect"' });
    expect(clicked.crmProspects?.[0].status).toBe("queued");
  });

  it("does not move an accepted prospect back to messaged", () => {
    const store = storeWithProspect("accepted");
    recordLinkedInSend(store, { ...facts, label: "Send" });
    expect(store.crmProspects?.[0].status).toBe("accepted");
  });
});
