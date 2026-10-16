import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  countLinkedInInvitesLast7Days,
  countLinkedInInvitesToday,
} from "@/lib/agent/linkedin-budget";
import { recordLinkedInSend } from "@/lib/agent/linkedin-send-log";
import { mutate } from "@/lib/mutate";
import { confirmOutboxItemSent } from "@/lib/outbox";
import { createSeedStore } from "@/lib/seed";
import type { OutboxItem, Store } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  store: null as Store | null,
  settled: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  updateStore: async (fn: (store: Store) => unknown) => fn(mocks.store!),
}));
vi.mock("@/lib/outbox-bot", () => ({ onOutboxItemSettled: mocks.settled }));

function item(status: OutboxItem["status"], kind: OutboxItem["kind"] = "message"): OutboxItem {
  return {
    id: `outbox_${status}_${kind}`,
    name: "Hedy Lamarr",
    profileUrl: "https://www.linkedin.com/in/hedy-lamarr/",
    text: "Approved text",
    status,
    kind,
    createdAt: "2026-09-25T07:00:00.000Z",
    createdBy: "operator",
  };
}

describe("confirmOutboxItemSent", () => {
  beforeEach(() => {
    mocks.store = createSeedStore();
    mocks.settled.mockReset();
  });

  it("records a sending invite at its original sending time", () => {
    const store = mocks.store!;
    const invite = item("sending", "invite");
    invite.sendingAt = "2026-09-25T08:00:51.000Z";
    invite.error = "stalled";
    store.outbox = [invite];

    confirmOutboxItemSent(
      store,
      { id: invite.id, evidence: "Seen in Sent invitations" },
      new Date("2026-09-25T12:00:00.000Z")
    );

    expect(invite).toMatchObject({
      status: "sent",
      sentAt: invite.sendingAt,
      operatorConfirmation: { evidence: "Seen in Sent invitations" },
    });
    expect(invite).not.toHaveProperty("error");
    expect(store.linkedinSendLog).toHaveLength(1);
    expect(store.linkedinSendLog![0]).toMatchObject({
      kind: "invite",
      outboxItemId: invite.id,
      at: invite.sendingAt,
      text: null,
    });
    expect(countLinkedInInvitesToday(new Date("2026-09-25T12:00:00.000Z"), store.linkedinSendLog!)).toBe(1);
  });

  it("records a new invite send when the existing entry for the item is voided", () => {
    const store = mocks.store!;
    const invite = item("sending", "invite");
    invite.sendingAt = "2026-09-25T08:00:51.000Z";
    const voidedEntry = recordLinkedInSend(store, {
      botId: "outbox",
      conversationId: "outbox",
      messageId: invite.id,
      url: invite.profileUrl,
      action: "click",
      label: null,
      text: null,
      at: "2026-09-24T08:00:51.000Z",
      kind: "invite",
    });
    voidedEntry.outboxItemId = invite.id;
    voidedEntry.voidedAt = "2026-09-24T09:00:00.000Z";
    voidedEntry.voidReason = "LinkedIn refused the invite";
    const voidedBefore = structuredClone(voidedEntry);
    store.outbox = [invite];
    const now = new Date("2026-09-25T12:00:00.000Z");
    const before = countLinkedInInvitesLast7Days(now, store.linkedinSendLog);

    confirmOutboxItemSent(store, { id: invite.id, evidence: "Seen in Sent invitations" }, now);

    const entries = store.linkedinSendLog!.filter((entry) => entry.outboxItemId === invite.id);
    expect(entries).toHaveLength(2);
    expect(entries.filter((entry) => entry.voidedAt)).toHaveLength(1);
    expect(entries.filter((entry) => !entry.voidedAt)).toHaveLength(1);
    expect(entries.find((entry) => entry.id === voidedEntry.id)).toEqual(voidedBefore);
    expect(countLinkedInInvitesLast7Days(now, store.linkedinSendLog)).toBe(before + 1);
  });

  it("does not duplicate an existing non-voided entry for the item", () => {
    const store = mocks.store!;
    const invite = item("sending", "invite");
    invite.sendingAt = "2026-09-25T08:00:51.000Z";
    const existingEntry = recordLinkedInSend(store, {
      botId: "outbox",
      conversationId: "outbox",
      messageId: invite.id,
      url: invite.profileUrl,
      action: "click",
      label: null,
      text: null,
      at: "2026-09-24T08:00:51.000Z",
      kind: "invite",
    });
    existingEntry.outboxItemId = invite.id;
    store.outbox = [invite];
    const logLength = store.linkedinSendLog!.length;

    confirmOutboxItemSent(
      store,
      { id: invite.id, evidence: "Seen in Sent invitations" },
      new Date("2026-09-25T12:00:00.000Z")
    );

    expect(store.linkedinSendLog!.filter((entry) => entry.outboxItemId === invite.id)).toHaveLength(1);
    expect(store.linkedinSendLog).toHaveLength(logLength);
  });

  it("moves pacing forward but never backward", () => {
    const store = mocks.store!;
    const first = item("sending");
    first.sendingAt = "2026-09-25T08:00:51.000Z";
    store.outbox = [first];
    store.settings.linkedinLastActionAt = "2026-09-25T07:00:00.000Z";
    confirmOutboxItemSent(store, { id: first.id, evidence: "Seen" });
    expect(store.settings.linkedinLastActionAt).toBe(first.sendingAt);

    const second = { ...item("failed"), id: "outbox_second", sendingAt: "2026-09-25T09:00:00.000Z" };
    store.outbox.push(second);
    store.settings.linkedinLastActionAt = "2026-09-25T10:00:00.000Z";
    confirmOutboxItemSent(store, { id: second.id, evidence: "Seen" });
    expect(store.settings.linkedinLastActionAt).toBe("2026-09-25T10:00:00.000Z");
  });

  it("clears the error and records a failed message", () => {
    const store = mocks.store!;
    const message = item("failed");
    message.error = "Send not confirmed. Check LinkedIn before retrying.";
    store.outbox = [message];
    confirmOutboxItemSent(store, { id: message.id, evidence: "Seen in the thread" });
    expect(message.status).toBe("sent");
    expect(message).not.toHaveProperty("error");
    expect(store.linkedinSendLog).toHaveLength(1);
    expect(store.linkedinSendLog![0].kind).toBe("message");
  });

  it.each(["approved", "sent"] as const)("rejects a %s item without changes", (status) => {
    const store = mocks.store!;
    const candidate = item(status);
    store.outbox = [candidate];
    const before = structuredClone(candidate);
    const logLength = store.linkedinSendLog?.length ?? 0;
    expect(() => confirmOutboxItemSent(store, { id: candidate.id, evidence: "Seen" })).toThrow();
    expect(candidate).toEqual(before);
    expect(store.linkedinSendLog?.length ?? 0).toBe(logLength);
  });

  it("rejects a second confirmation and blank evidence without changes", () => {
    const store = mocks.store!;
    const candidate = item("sending");
    store.outbox = [candidate];
    expect(() => confirmOutboxItemSent(store, { id: candidate.id, evidence: "   " })).toThrow();
    expect(candidate.status).toBe("sending");
    expect(store.linkedinSendLog ?? []).toHaveLength(0);
    confirmOutboxItemSent(store, { id: candidate.id, evidence: "Seen" });
    const before = structuredClone(candidate);
    const logLength = store.linkedinSendLog!.length;
    expect(() => confirmOutboxItemSent(store, { id: candidate.id, evidence: "Seen again" })).toThrow();
    expect(candidate).toEqual(before);
    expect(store.linkedinSendLog).toHaveLength(logLength);
  });

  it("settles only an actively sending run", async () => {
    const sending = item("sending");
    mocks.store!.outbox = [sending];
    await mutate({ op: "confirmOutboxItemSent", id: sending.id, evidence: "Seen" });
    expect(mocks.settled).toHaveBeenCalledOnce();
    expect(mocks.settled).toHaveBeenCalledWith(mocks.store, "sent");

    mocks.settled.mockClear();
    const failed = item("failed");
    mocks.store!.outbox = [failed];
    await mutate({ op: "confirmOutboxItemSent", id: failed.id, evidence: "Seen" });
    expect(mocks.settled).not.toHaveBeenCalled();
  });
});
