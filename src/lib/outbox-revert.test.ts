import { describe, expect, it } from "vitest";

import { countLinkedInInvitesToday } from "@/lib/agent/linkedin-budget";
import { revertOutboxItemSent, sha256Hex } from "@/lib/outbox";
import { createSeedStore } from "@/lib/seed";
import type { LinkedInSendEntry, OutboxItem, Store } from "@/lib/types";

const now = new Date("2026-09-26T12:00:00.000Z");
const evidence = "Refused: weekly limit";

function sentInvite(): OutboxItem {
  const text = "Hello Hedy";
  return {
    id: "outbox_hedy",
    name: "Hedy Lamarr",
    profileUrl: "https://www.linkedin.com/in/hedy-lamarr/",
    text,
    status: "sent",
    kind: "invite",
    approvedTextHash: sha256Hex(text),
    sentAt: "2026-09-26T08:00:00.000Z",
    createdAt: "2026-09-25T08:00:00.000Z",
    createdBy: "operator",
  };
}

function sendEntry(outboxItemId = "outbox_hedy"): LinkedInSendEntry {
  return {
    id: `send_${outboxItemId}`,
    at: "2026-09-26T08:00:00.000Z",
    botId: "outbox",
    conversationId: "outbox",
    messageId: outboxItemId,
    url: "https://www.linkedin.com/in/hedy-lamarr/",
    slug: "hedy-lamarr",
    action: "click",
    label: null,
    key: null,
    text: null,
    kind: "invite",
    outboxItemId,
  };
}

function storeWithInvite(): { store: Store; invite: OutboxItem } {
  const store = createSeedStore();
  const invite = sentInvite();
  store.outbox = [invite];
  store.linkedinSendLog = [sendEntry()];
  return { store, invite };
}

describe("revertOutboxItemSent", () => {
  it("returns a sent invite to approved and voids its send log", () => {
    const { store, invite } = storeWithInvite();
    const approvedTextHash = invite.approvedTextHash;
    expect(countLinkedInInvitesToday(now, store.linkedinSendLog)).toBe(1);

    revertOutboxItemSent(store, { id: invite.id, evidence }, now);

    expect(invite.status).toBe("approved");
    expect(invite).not.toHaveProperty("sentAt");
    expect(invite.operatorCorrection?.evidence).toBe(evidence);
    expect(invite.approvedTextHash).toBe(approvedTextHash);
    expect(store.linkedinSendLog).toHaveLength(1);
    expect(store.linkedinSendLog![0]).toMatchObject({
      voidedAt: now.toISOString(),
      voidReason: evidence,
    });
    expect(countLinkedInInvitesToday(now, store.linkedinSendLog)).toBe(0);
    expect(store.computerLogs.at(-1)?.summary).toMatch(
      /^Outbox send reverted by the operator:/
    );
  });

  it("requeues a pending prospect only when no non-voided invite remains", () => {
    const first = storeWithInvite();
    first.store.crmProspects = [{
      id: "prospect_hedy",
      at: now.toISOString(),
      botId: "outbox",
      name: "Hedy Lamarr",
      profileUrl: first.invite.profileUrl,
      slug: "hedy-lamarr",
      lane: "A",
      source: "linkedin",
      status: "pending",
      note: "",
    }];
    revertOutboxItemSent(first.store, { id: first.invite.id, evidence }, now);
    expect(first.store.crmProspects[0].status).toBe("queued");

    const second = storeWithInvite();
    second.store.crmProspects = structuredClone(first.store.crmProspects);
    second.store.crmProspects[0].status = "pending";
    second.store.linkedinSendLog!.push(sendEntry("outbox_other"));
    revertOutboxItemSent(second.store, { id: second.invite.id, evidence }, now);
    expect(second.store.crmProspects[0].status).toBe("pending");
  });

  it.each([
    ["approved", evidence],
    ["sending", evidence],
    ["sent", "   "],
  ] as const)("rejects a %s item with evidence %j without changes", (status, suppliedEvidence) => {
    const { store, invite } = storeWithInvite();
    invite.status = status;
    const before = structuredClone(store);
    expect(() =>
      revertOutboxItemSent(store, { id: invite.id, evidence: suppliedEvidence }, now)
    ).toThrow(Error);
    expect(store).toEqual(before);
  });
});
