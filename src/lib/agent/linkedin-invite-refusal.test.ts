import { describe, expect, it } from "vitest";

import {
  checkLinkedInInvitePause,
  findLinkedInInviteRefusal,
  pauseLinkedInInvites,
} from "@/lib/agent/linkedin-budget";
import type { Settings } from "@/lib/types";

const refusal = "Your invitation to Sharon was not sent because you have reached the weekly limit for connection invitations.";

describe("LinkedIn invitation refusal", () => {
  it("extracts the refusal sentence only", () => {
    expect(findLinkedInInviteRefusal(`${refusal} Please try again next week.`)).toBe(refusal);
    expect(findLinkedInInviteRefusal("Invitation sent." )).toBeNull();
    expect(findLinkedInInviteRefusal(null)).toBeNull();
  });

  it("pauses invitations for 24 hours", () => {
    const settings = {} as Settings;
    const now = new Date("2026-09-26T10:00:00.000Z");
    const until = pauseLinkedInInvites(settings, "weekly limit", now);
    const during = checkLinkedInInvitePause(settings, new Date(now.getTime() + 23 * 60 * 60 * 1000));
    expect(during.status).toBe("refused");
    expect(during.status === "refused" && during.nextAllowedAt).toEqual(until);
    expect(checkLinkedInInvitePause(settings, new Date(now.getTime() + 25 * 60 * 60 * 1000))).toEqual({ status: "allowed" });
  });
});
