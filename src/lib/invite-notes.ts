import { linkedInProfileSlug } from "@/lib/agent/linkedin-send-log";
import type { InviteNoteVariant, Store } from "@/lib/types";

export const DEFAULT_INVITE_NOTE_VARIANTS: InviteNoteVariant[] = [
  { id: "a-one-free-app", lane: "A", phrase: "one free app" },
  { id: "a-free-apps-client-stories", lane: "A", phrase: "building free apps" },
  { id: "a-ai-tools", lane: "A", phrase: "I build AI tools for businesses" },
  {
    id: "b-check-ai-coding",
    lane: "B",
    phrase: "building a check for teams using AI coding tools",
  },
];

export function inviteNoteVariant(
  text: string,
  lane: "A" | "B" | undefined,
  variants: InviteNoteVariant[]
) {
  const normalizedText = text.toLowerCase();
  return (
    variants.find(
      (variant) =>
        (lane === undefined || variant.lane === lane) &&
        normalizedText.includes(variant.phrase.toLowerCase())
    )?.id ?? "unmatched"
  );
}

export interface InviteNoteReportRow {
  lane: string;
  variant: string;
  sent: number;
  accepted: number;
  within14: number;
  younger: number;
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export function inviteNoteReport(store: Store, now: Date): InviteNoteReportRow[] {
  const rows = new Map<string, InviteNoteReportRow>();
  const variants = store.settings.inviteNoteVariants ?? DEFAULT_INVITE_NOTE_VARIANTS;

  for (const item of store.outbox ?? []) {
    if (item.kind !== "invite" || item.status !== "sent" || !item.sentAt) continue;

    const lane = item.lane ?? "?";
    const variant = item.noteVariant ?? inviteNoteVariant(item.text, item.lane, variants);
    const key = `${lane}\u0000${variant}`;
    const row = rows.get(key) ?? { lane, variant, sent: 0, accepted: 0, within14: 0, younger: 0 };
    row.sent += 1;

    const slug = linkedInProfileSlug(item.profileUrl)?.toLowerCase();
    const prospect = slug
      ? store.crmProspects?.find((candidate) => candidate.slug?.toLowerCase() === slug)
      : undefined;
    const sentAt = new Date(item.sentAt).getTime();
    if (prospect?.status === "accepted") {
      row.accepted += 1;
      const acceptedAt = new Date(prospect.acceptedAt ?? prospect.acceptedSync?.at ?? "").getTime();
      const elapsed = acceptedAt - sentAt;
      if (!Number.isNaN(elapsed) && elapsed <= FOURTEEN_DAYS_MS) row.within14 += 1;
    }
    if (!Number.isNaN(sentAt) && now.getTime() - sentAt < FOURTEEN_DAYS_MS) row.younger += 1;
    rows.set(key, row);
  }

  return [...rows.values()].sort((a, b) => {
    if (a.lane < b.lane) return -1;
    if (a.lane > b.lane) return 1;
    if (a.variant < b.variant) return -1;
    if (a.variant > b.variant) return 1;
    return 0;
  });
}
