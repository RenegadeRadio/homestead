import { nid, nowIso } from "@/lib/ids";
import { isLinkedInUrl } from "@/lib/agent/linkedin-pacing";
import type {
  LinkedInSendAction,
  LinkedInSendEntry,
  LinkedInSendKind,
  OutboxItem,
  Store,
} from "@/lib/types";

declare global {
  var __crewLinkedInTypedText: Map<string, string[]> | undefined;
}

const typedTextByPage = (globalThis.__crewLinkedInTypedText ??= new Map<string, string[]>());

function pageKey(url: string) {
  return url.split("#")[0].split("?")[0];
}

export function typedTextFor(url: string): string {
  return typedTextByPage.get(pageKey(url))?.join("") ?? "";
}

export function linkedInProfileSlug(url: string): string | null {
  if (!isLinkedInUrl(url)) return null;
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const profileIndex = segments.indexOf("in");
    if (profileIndex < 0 || profileIndex === segments.length - 1) return null;
    return decodeURIComponent(segments[profileIndex + 1]).toLowerCase();
  } catch {
    return null;
  }
}

export function ensureInviteProspect(store: Store, item: OutboxItem) {
  if (item.kind !== "invite" || item.status !== "sent" || !item.lane) return undefined;
  const slug = linkedInProfileSlug(item.profileUrl);
  if (!slug) return undefined;

  const existing = store.crmProspects?.find((prospect) => prospect.slug === slug);
  if (existing) {
    if (existing.status === "queued" || existing.status === "connected") {
      existing.status = "pending";
    }
    return existing;
  }

  const prospect = {
    id: nid("prospect"),
    at: item.sentAt ?? nowIso(),
    botId: "outbox" as const,
    name: item.name,
    profileUrl: item.profileUrl,
    slug,
    lane: item.lane,
    source: "linkedin" as const,
    status: "pending" as const,
    note: `Created from sent Outbox invite ${item.id}.`,
  };
  (store.crmProspects ??= []).push(prospect);
  return prospect;
}

export function reconcileInviteProspects(store: Store) {
  let created = 0;
  let moved = 0;
  for (const item of store.outbox ?? []) {
    if (item.kind !== "invite" || item.status !== "sent") continue;
    const slug = linkedInProfileSlug(item.profileUrl);
    const existing = slug
      ? store.crmProspects?.find((prospect) => prospect.slug === slug)
      : undefined;
    const previousStatus = existing?.status;
    const prospect = ensureInviteProspect(store, item);
    if (!existing && prospect) created += 1;
    if (
      existing &&
      (previousStatus === "queued" || previousStatus === "connected") &&
      prospect?.status === "pending"
    ) {
      moved += 1;
    }
  }
  return { created, moved };
}

export function rememberTypedText(url: string, text: string) {
  const key = pageKey(url);
  const remembered = typedTextByPage.get(key) ?? [];
  remembered.push(text);
  typedTextByPage.set(key, remembered);
}

export function forgetTypedText(url: string) {
  typedTextByPage.delete(pageKey(url));
}

function labelText(label: string | null) {
  if (!label) return null;
  const snapshotLabel = label.match(/^\[\d+\].*?[“"]([^”"]+)[”"]\s*$/);
  return snapshotLabel?.[1] ?? label;
}

const INVITE_CONFIRMATION_TEXTS = new Set([
  "send",
  "send invitation",
  "send without a note",
]);

export function isConnectClickLabel(label: string | null): boolean {
  const quoted = label?.match(/["“]([^"”]*)["”]/)?.[1]?.trim().toLowerCase();
  return quoted != null && !INVITE_CONFIRMATION_TEXTS.has(quoted);
}

export function isInviteConfirmation(store: Store, url: string, label: string | null, now: Date) {
  const slug = linkedInProfileSlug(url);
  const text = labelText(label)?.trim().toLowerCase();
  if (!slug || !text || !INVITE_CONFIRMATION_TEXTS.has(text)) return false;
  const cutoff = now.getTime() - 15 * 60 * 1000;
  return (store.linkedinSendLog ?? []).some((entry) => {
    const at = new Date(entry.at).getTime();
    const entryText = labelText(entry.label)?.trim().toLowerCase();
    return entry.kind === "invite" && entry.slug === slug && at >= cutoff && at <= now.getTime() &&
      (entryText == null || !INVITE_CONFIRMATION_TEXTS.has(entryText));
  });
}

function classifyKind(
  current: {
    action: LinkedInSendAction;
    label: string | null;
    key: string | null;
    slug: string | null;
  },
  log: LinkedInSendEntry[],
  now: Date
): LinkedInSendKind {
  const label = labelText(current.label);
  if (label && /\b(connect|invite|invitation)\b/i.test(label)) return "invite";
  if (label && /^send( without a note)?$/i.test(label) && current.slug) {
    const cutoff = now.getTime() - 15 * 60 * 1000;
    if (
      log.some(
        (entry) =>
          entry.kind === "invite" &&
          entry.slug === current.slug &&
          new Date(entry.at).getTime() >= cutoff &&
          new Date(entry.at).getTime() <= now.getTime()
      )
    ) {
      return "invite";
    }
  }
  if (current.action === "type") return "message";
  const lastKey = current.key?.split("+").at(-1)?.toLowerCase();
  if (current.action === "press" && (lastKey === "enter" || lastKey === "numpadenter")) {
    return "message";
  }
  if (current.action === "click" && label && /^send$/i.test(label)) return "message";
  return "unknown";
}

export function recordLinkedInSend(
  store: Store,
  input: {
    botId: string;
    conversationId: string;
    messageId: string;
    url: string;
    action: LinkedInSendAction;
    label?: string | null;
    key?: string | null;
    text?: string | null;
    at?: string;
    kind?: LinkedInSendKind;
  }
): LinkedInSendEntry {
  const page = pageKey(input.url);
  const slug = linkedInProfileSlug(input.url);
  const now = new Date();
  const label = input.label ?? null;
  const key = input.key ?? null;
  const remembered = typedTextByPage.get(page);
  const text =
    input.action === "type"
      ? (input.text ?? null)
      : remembered && remembered.length > 0
        ? remembered.join("")
        : null;
  const log = store.linkedinSendLog ?? [];
  const kind = input.kind ?? classifyKind({ action: input.action, label, key, slug }, log, now);
  const entry: LinkedInSendEntry = {
    id: nid("send"),
    at: input.at ?? now.toISOString(),
    botId: input.botId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    url: input.url,
    slug,
    action: input.action,
    label,
    key,
    text,
    kind,
  };
  store.linkedinSendLog ??= [];
  store.linkedinSendLog.push(entry);
  if (entry.slug) {
    const prospect = store.crmProspects?.find((candidate) => candidate.slug === entry.slug);
    if (prospect && prospect.status !== "accepted") {
      if (
        entry.kind === "invite" &&
        !isConnectClickLabel(entry.label) &&
        prospect.status !== "messaged"
      ) {
        prospect.status = "pending";
      } else if (entry.kind === "message") {
        prospect.status = "messaged";
      }
    }
  }
  if (entry.kind === "message" && entry.slug) {
    const item = store.outbox?.find(
      (candidate) =>
        candidate.status === "sending" && candidate.kind !== "invite" &&
        linkedInProfileSlug(candidate.profileUrl) === entry.slug
    );
    if (item) {
      item.status = "sent";
      item.sentAt = entry.at;
      if (item.kind === "invite") ensureInviteProspect(store, item);
      entry.outboxItemId = item.id;
      if (item.lane) entry.lane = item.lane;
      const sentText = entry.text?.replace(/\s+/g, " ").trim() ?? null;
      const approvedText = item.text.replace(/\s+/g, " ").trim();
      if (sentText !== approvedText) item.error = "Sent text differs from the approved text.";
    }
  }
  const confirmationText = labelText(label)?.trim().toLowerCase();
  if (
    entry.kind === "invite" && entry.slug && confirmationText &&
    INVITE_CONFIRMATION_TEXTS.has(confirmationText)
  ) {
    const item = store.outbox?.find(
      (candidate) => candidate.status === "sending" && candidate.kind === "invite" &&
        linkedInProfileSlug(candidate.profileUrl) === entry.slug
    );
    if (item) {
      item.status = "sent";
      item.sentAt = entry.at;
      if (item.kind === "invite") ensureInviteProspect(store, item);
      entry.outboxItemId = item.id;
      if (item.lane) entry.lane = item.lane;
    }
  }
  typedTextByPage.delete(page);
  return entry;
}
