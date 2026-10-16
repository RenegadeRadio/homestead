import { createHash } from "node:crypto";

import {
  DEFAULT_BANNED_PHRASES,
  draftCheckRefusal,
  findDraftProblems,
} from "@/lib/agent/draft-check";
import { noteLinkedInSendPaced } from "@/lib/agent/linkedin-pacing";
import {
  ensureInviteProspect,
  linkedInProfileSlug,
  recordLinkedInSend,
} from "@/lib/agent/linkedin-send-log";
import { nid, nowIso } from "@/lib/ids";
import { DEFAULT_INVITE_NOTE_VARIANTS, inviteNoteVariant } from "@/lib/invite-notes";
import type { OutboxItem, Store } from "@/lib/types";

export function sha256Hex(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function checkDraft(store: Store, text: string) {
  const problems = findDraftProblems(
    text,
    store.settings.draftBannedPhrases ?? DEFAULT_BANNED_PHRASES
  );
  if (problems.length) throw new Error(draftCheckRefusal(problems));
}

function findItem(store: Store, id: string) {
  const item = store.outbox?.find((candidate) => candidate.id === id);
  if (!item) throw new Error("Outbox item not found.");
  return item;
}

export function createOutboxItem(
  store: Store,
  input: Pick<OutboxItem, "name" | "profileUrl" | "text" | "note" | "createdBy" | "lane" | "kind">
) {
  checkDraft(store, input.text);
  if (!linkedInProfileSlug(input.profileUrl)) throw new Error("Not a LinkedIn profile URL.");
  if (input.kind === "invite" && input.text.length > 200) {
    throw new Error("An invite note must be 200 characters or fewer.");
  }
  const item: OutboxItem = {
    id: nid("outbox"),
    name: input.name,
    profileUrl: input.profileUrl,
    text: input.text,
    status: "draft",
    note: input.note,
    createdAt: nowIso(),
    createdBy: input.createdBy,
  };
  if (input.kind === "invite") item.kind = "invite";
  if (input.lane === "A" || input.lane === "B") item.lane = input.lane;
  if (item.kind === "invite") {
    item.noteVariant = inviteNoteVariant(
      item.text,
      item.lane,
      store.settings.inviteNoteVariants ?? DEFAULT_INVITE_NOTE_VARIANTS
    );
  }
  (store.outbox ??= []).push(item);
  return item;
}

export function updateOutboxItem(store: Store, input: { id: string; text: string }) {
  const item = findItem(store, input.id);
  if (item.status === "sent") throw new Error("Sent outbox items cannot be updated.");
  checkDraft(store, input.text);
  if (item.kind === "invite" && input.text.length > 200) {
    throw new Error("An invite note must be 200 characters or fewer.");
  }
  item.text = input.text;
  if (item.kind === "invite") {
    item.noteVariant = inviteNoteVariant(
      item.text,
      item.lane,
      store.settings.inviteNoteVariants ?? DEFAULT_INVITE_NOTE_VARIANTS
    );
  }
  item.status = "draft";
  delete item.approvedTextHash;
  delete item.error;
  return item;
}

export function approveOutboxItems(store: Store, input: { ids: string[] }) {
  const approved: OutboxItem[] = [];
  for (const item of store.outbox ?? []) {
    if (!input.ids.includes(item.id) || !["draft", "failed"].includes(item.status)) continue;
    if (item.status === "failed") {
      const at = nowIso();
      for (const entry of store.linkedinSendLog ?? []) {
        if (entry.outboxItemId !== item.id || !entry.stalled || entry.voidedAt) continue;
        entry.voidedAt = at;
        entry.voidReason = "Re-approved after a stalled send.";
      }
    }
    item.status = "approved";
    item.approvedTextHash = sha256Hex(item.text);
    approved.push(item);
  }
  return approved;
}

export function rejectOutboxItem(store: Store, input: { id: string }) {
  const item = findItem(store, input.id);
  item.status = "rejected";
  return item;
}

export function failOutboxItem(store: Store, input: { id: string }) {
  const item = findItem(store, input.id);
  if (item.status !== "sending") return item;
  item.status = "failed";
  item.error = "Stopped by the operator.";
  return item;
}

export function confirmOutboxItemSent(
  store: Store,
  input: { id: string; evidence: string },
  now = new Date()
) {
  const item = findItem(store, input.id);
  if (item.status !== "sending" && item.status !== "failed") {
    throw new Error("Only sending or failed outbox items can be confirmed sent.");
  }
  const evidence = input.evidence.trim();
  if (!evidence) throw new Error("Evidence is required.");

  const confirmedAt = now.toISOString();
  const sentAt = item.sendingAt ?? confirmedAt;
  item.status = "sent";
  item.sentAt = sentAt;
  item.operatorConfirmation = { at: confirmedAt, evidence };
  delete item.error;

  if (
    !(store.linkedinSendLog ?? []).some(
      (entry) => entry.outboxItemId === item.id && !entry.voidedAt
    )
  ) {
    const entry = recordLinkedInSend(store, {
      botId: "outbox",
      conversationId: "outbox",
      messageId: item.id,
      url: item.profileUrl,
      action: "click",
      label: null,
      text: null,
      at: sentAt,
      kind: item.kind ?? "message",
    });
    entry.text = null;
    entry.outboxItemId = item.id;
    if (item.lane) entry.lane = item.lane;
  }
  if (item.kind === "invite") ensureInviteProspect(store, item);

  noteLinkedInSendPaced(store.settings, sentAt);
  store.computerLogs.push({
    id: nid("log"),
    at: confirmedAt,
    botId: "outbox",
    kind: "browser",
    summary: `Outbox sent (confirmed by the operator): ${item.name} ${evidence}`,
  });
  delete item.error;
  return item;
}

export function revertOutboxItemSent(
  store: Store,
  input: { id: string; evidence: string },
  now = new Date()
) {
  const item = findItem(store, input.id);
  if (item.status !== "sent") {
    throw new Error("Only sent outbox items can be returned to the queue.");
  }
  const evidence = input.evidence.trim();
  if (!evidence) throw new Error("Evidence is required.");

  const at = now.toISOString();
  item.status = "approved";
  delete item.sentAt;
  delete item.error;
  delete item.operatorConfirmation;
  item.operatorCorrection = { at, evidence };

  for (const entry of store.linkedinSendLog ?? []) {
    if (entry.outboxItemId !== item.id) continue;
    entry.voidedAt = at;
    entry.voidReason = evidence;
  }

  if (item.kind === "invite") {
    const slug = linkedInProfileSlug(item.profileUrl);
    const prospect = slug
      ? store.crmProspects?.find((candidate) => candidate.slug === slug)
      : undefined;
    const hasRemainingInvite = slug
      ? (store.linkedinSendLog ?? []).some(
          (entry) => entry.slug === slug && entry.kind === "invite" && !entry.voidedAt
        )
      : false;
    if (prospect?.status === "pending" && !hasRemainingInvite) {
      prospect.status = "queued";
    }
  }

  store.computerLogs.push({
    id: nid("log"),
    at,
    botId: "outbox",
    kind: "browser",
    summary: `Outbox send reverted by the operator: ${item.name} ${evidence}`,
  });
  return item;
}

export function deleteOutboxItem(store: Store, input: { id: string }) {
  store.outbox = (store.outbox ?? []).filter((item) => item.id !== input.id);
  return { ok: true };
}
