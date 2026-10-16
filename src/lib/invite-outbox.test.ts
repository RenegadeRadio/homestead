import { describe, expect, it, vi } from "vitest";

import { executeTool } from "@/lib/agent/execute";
import { isInviteConfirmation, recordLinkedInSend } from "@/lib/agent/linkedin-send-log";
import { createOutboxItem } from "@/lib/outbox";
import { createSeedStore } from "@/lib/seed";
import { syncSendEntry } from "@/lib/crm/notion-sync";

describe("LinkedIn invite Outbox support", () => {
  it("queues an invite with its supporting research", async () => {
    const store = createSeedStore();
    const bot = store.bots[0];
    await executeTool(
      "queue_linkedin_message",
      {
        name: "Ada",
        profileUrl: "https://www.linkedin.com/in/ada",
        text: "Hello Ada",
        kind: "invite",
        note: 'Ada launched the project. Quote: "Launch" https://example.com',
      },
      {
        store,
        bot,
        conversationId: store.conversations[0].id,
        messageId: store.messages[0].id,
      }
    );
    expect(store.outbox?.[0]).toMatchObject({
      kind: "invite",
      note: 'Ada launched the project. Quote: "Launch" https://example.com',
    });
  });

  it("enforces the 200 character invite-note limit", () => {
    const store = createSeedStore();
    expect(
      createOutboxItem(store, {
        name: "Ada",
        profileUrl: "https://www.linkedin.com/in/ada",
        text: "a".repeat(200),
        kind: "invite",
        createdBy: "operator",
      }).text
    ).toHaveLength(200);
    expect(() =>
      createOutboxItem(store, {
        name: "Grace",
        profileUrl: "https://www.linkedin.com/in/grace",
        text: "a".repeat(201),
        kind: "invite",
        createdBy: "operator",
      })
    ).toThrow("An invite note must be 200 characters or fewer.");
  });

  it("recognizes a recent Connect followed by Send, but not an old Connect", () => {
    const store = createSeedStore();
    const url = "https://www.linkedin.com/in/ada";
    store.linkedinSendLog = [{
      id: "send_connect",
      at: "2026-09-18T09:59:30.000Z",
      botId: store.bots[0].id,
      conversationId: store.conversations[0].id,
      messageId: store.messages[0].id,
      url,
      slug: "ada",
      action: "click",
      label: '[3] button "Connect"',
      key: null,
      text: null,
      kind: "invite",
    }];
    expect(isInviteConfirmation(store, url, '[5] button "Send"', new Date("2026-09-18T10:00:00Z"))).toBe(true);
    expect(isInviteConfirmation(store, url, '[5] button "Send"', new Date("2026-09-18T10:15:30Z"))).toBe(false);
  });

  it("completes a sending invite only on its confirmation", () => {
    const store = createSeedStore();
    const item = createOutboxItem(store, {
      name: "Ada",
      profileUrl: "https://www.linkedin.com/in/ada",
      text: "Hello Ada",
      kind: "invite",
      lane: "A",
      createdBy: "operator",
    });
    item.status = "sending";
    const common = {
      botId: store.bots[0].id,
      conversationId: store.conversations[0].id,
      messageId: store.messages[0].id,
      url: item.profileUrl,
      action: "click" as const,
    };
    recordLinkedInSend(store, { ...common, label: '[3] button "Connect"' });
    expect(item.status).toBe("sending");
    const confirmation = recordLinkedInSend(store, { ...common, label: '[5] button "Send"' });
    expect(item.status).toBe("sent");
    expect(confirmation).toMatchObject({ outboxItemId: item.id, lane: "A" });
  });

  it("does not sync the Connect click to the CRM", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const store = createSeedStore();
    await expect(
      syncSendEntry(
        {
          id: "send_connect",
          at: "2026-09-18T10:00:00.000Z",
          botId: store.bots[0].id,
          conversationId: store.conversations[0].id,
          messageId: store.messages[0].id,
          url: "https://www.linkedin.com/in/ada",
          slug: "ada",
          action: "click",
          label: '[3] button "Connect"',
          key: null,
          text: null,
          kind: "invite",
        },
        { fetchFn, env: { CREW_NOTION_TOKEN: "token" } }
      )
    ).resolves.toEqual({
      state: "skipped",
      detail: "Connect click; the invite is recorded at Send.",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
