import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));
vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) => fn(state.store)),
}));
vi.mock("@/lib/agent/run", () => ({ handleUserMessage: vi.fn(async () => {}) }));

import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { startNextOutboxItem } from "@/lib/outbox-bot";
import { sendInviteDirect, type OutboxDirectDeps } from "@/lib/outbox-direct";
import { createSeedStore } from "@/lib/seed";

const refusal = "Your invitation to Sharon was not sent because you have reached the weekly limit for connection invitations.";

function approved(kind: "invite" | "message") {
  const item = createOutboxItem(state.store, {
    name: "Ada Lovelace", profileUrl: "https://www.linkedin.com/in/ada-lovelace",
    text: "Hello Ada", kind: kind === "invite" ? "invite" : undefined, createdBy: "operator",
  });
  approveOutboxItems(state.store, { ids: [item.id] });
  return item;
}

describe("direct LinkedIn refusal", () => {
  beforeEach(() => {
    state.store = createSeedStore();
    state.store.settings.linkedinSendWindowStart = state.store.settings.linkedinSendWindowEnd = "09:00";
    state.store.settings.linkedinActionGapMinSeconds = state.store.settings.linkedinActionGapMaxSeconds = 0;
  });

  it("returns an invite to approved without recording it", async () => {
    const item = approved("invite");
    item.status = "sending";
    let sent = false;
    let menuOpen = false;
    let dialogOpen = false;
    let noteOpen = false;
    const deps: OutboxDirectDeps = {
      now: () => new Date("2026-09-26T10:00:00.000Z"), sleep: async () => {},
      navigate: async (url) => ({ url, gateNeeded: false, gateReason: "" }),
      pageUrl: async () => item.profileUrl, pageText: async () => sent ? refusal : "",
      waitForControl: async ({ scope, role, name }) => {
        const matches = (label: string) => !name || name.test(label);
        if (scope === "main" && !menuOpen && matches("More")) return "More";
        if (scope === "menu" && menuOpen && matches("Connect")) return "Connect";
        if (scope === "dialog" && dialogOpen && !noteOpen && matches("Add a note")) return "Add a note";
        if (scope === "dialog" && role === "textbox" && noteOpen) return "textbox";
        if (scope === "dialog" && noteOpen && matches("Send invitation")) return "Send invitation";
        return null;
      },
      controlName: async (control) => String(control), controlHref: async () => null,
      click: async (control) => {
        const label = String(control);
        if (label === "More") menuOpen = true;
        if (label === "Connect") dialogOpen = true;
        if (label === "Add a note") noteOpen = true;
        if (label === "Send invitation") sent = true;
      },
      fill: async () => {}, dialogText: async () => "Add a note to your invitation to Ada",
      findInviteLinks: async () => [], describeInviteControls: async () => "fake controls",
    };
    const result = await sendInviteDirect(item.id, deps);
    expect(result).toEqual({ outcome: "refused", reason: refusal });
    expect(item.status).toBe("approved");
    expect(item.error).toMatch(/^LinkedIn refused this invitation:/);
    expect(state.store.linkedinSendLog ?? []).toHaveLength(0);
    expect(state.store.settings.linkedinInvitesPausedUntil).toBeTruthy();
  });

  it("pauses invites but still starts messages", async () => {
    const invite = approved("invite");
    state.store.settings.linkedinInvitesPausedUntil = new Date("2099-01-01T00:00:00.000Z").toISOString();
    state.store.settings.linkedinInvitePauseReason = "weekly limit";
    const blocked = await startNextOutboxItem();
    expect(blocked.started).toBe(false);
    expect(blocked.started === false && blocked.reason).toContain("paused");
    invite.status = "draft";
    const message = approved("message");
    expect((await startNextOutboxItem()).started).toBe(true);
    expect(message.status).toBe("sending");
  });
});
