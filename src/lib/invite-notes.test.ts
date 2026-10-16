import { describe, expect, it } from "vitest";

import {
  DEFAULT_INVITE_NOTE_VARIANTS,
  inviteNoteReport,
  inviteNoteVariant,
} from "@/lib/invite-notes";
import { createSeedStore } from "@/lib/seed";
import type { CrmProspectEntry, OutboxItem } from "@/lib/types";

function sentInvite(
  id: string,
  slug: string,
  text: string,
  sentAt: string,
  noteVariant?: string
): OutboxItem {
  return {
    id,
    name: slug,
    profileUrl: `https://www.linkedin.com/in/${slug}/`,
    text,
    status: "sent",
    kind: "invite",
    lane: "A",
    noteVariant,
    sentAt,
    createdAt: sentAt,
    createdBy: "operator",
  };
}

function prospect(
  slug: string,
  status: CrmProspectEntry["status"],
  acceptedAt?: string
): CrmProspectEntry {
  return {
    id: `prospect_${slug}`,
    at: "2026-09-01T00:00:00.000Z",
    botId: "bot_1",
    name: slug,
    profileUrl: `https://www.linkedin.com/in/${slug}/`,
    slug,
    lane: "A",
    source: "linkedin",
    status,
    note: "test",
    acceptedAt,
  };
}

describe("invite note variants", () => {
  it("classifies default A and B notes and leaves other notes unmatched", () => {
    expect(inviteNoteVariant("Try one free app today", "A", DEFAULT_INVITE_NOTE_VARIANTS)).toBe(
      "a-one-free-app"
    );
    expect(
      inviteNoteVariant(
        "We are building a check for teams using AI coding tools",
        "B",
        DEFAULT_INVITE_NOTE_VARIANTS
      )
    ).toBe("b-check-ai-coding");
    expect(inviteNoteVariant("Hello there", "A", DEFAULT_INVITE_NOTE_VARIANTS)).toBe(
      "unmatched"
    );
  });

  it("reports sent and accepted invites by lane and variant", () => {
    const store = createSeedStore();
    store.outbox = [
      sentInvite("one", "one", "Try one free app", "2026-09-20T00:00:00.000Z"),
      sentInvite("two", "two", "Try one free app", "2026-09-20T00:00:00.000Z"),
      sentInvite(
        "three",
        "three",
        "I build AI tools for businesses",
        "2026-10-08T00:00:00.000Z"
      ),
    ];
    store.crmProspects = [
      prospect("one", "accepted", "2026-09-25T00:00:00.000Z"),
      prospect("two", "accepted", "2026-10-09T00:00:00.000Z"),
      prospect("three", "pending"),
    ];

    expect(inviteNoteReport(store, new Date("2026-10-10T00:00:00.000Z"))).toEqual([
      { lane: "A", variant: "a-ai-tools", sent: 1, accepted: 0, within14: 0, younger: 1 },
      { lane: "A", variant: "a-one-free-app", sent: 2, accepted: 2, within14: 1, younger: 0 },
    ]);
  });

  it("uses a stored variant instead of reclassifying the text", () => {
    const store = createSeedStore();
    store.outbox = [
      sentInvite(
        "one",
        "one",
        "I build AI tools for businesses",
        "2026-10-08T00:00:00.000Z",
        "recorded-variant"
      ),
    ];
    store.crmProspects = [];

    expect(inviteNoteReport(store, new Date("2026-10-10T00:00:00.000Z"))).toEqual([
      { lane: "A", variant: "recorded-variant", sent: 1, accepted: 0, within14: 0, younger: 1 },
    ]);
  });
});
