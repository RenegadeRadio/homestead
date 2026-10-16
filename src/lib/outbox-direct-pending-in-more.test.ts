import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) => fn(state.store)),
}));

import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { sendInviteDirect, type OutboxDirectDeps } from "@/lib/outbox-direct";
import { createSeedStore } from "@/lib/seed";

const profileUrl = "https://www.linkedin.com/in/ada-lovelace";

function fake(pendingInMenu: boolean): OutboxDirectDeps {
  let menuOpen = false;
  let dialogOpen = false;
  let noteOpen = false;
  let sent = false;
  return {
    now: () => new Date("2026-09-29T10:00:00.000Z"),
    sleep: async () => undefined,
    navigate: async (url) => ({ url, gateNeeded: false, gateReason: "" }),
    pageUrl: async () => profileUrl,
    pageText: async () => "",
    waitForControl: async ({ scope, role, name }) => {
      const matches = (label: string) => !name || name.test(label);
      if (scope === "main" && role === "button" && !menuOpen && matches("More")) return "More";
      if (scope === "menu" && role === "button" && menuOpen && !sent && matches("Connect")) return "Connect";
      if (scope === "dialog" && role === "button" && dialogOpen && !noteOpen && matches("Add a note")) return "Add a note";
      if (scope === "dialog" && role === "textbox" && noteOpen) return "textbox";
      if (scope === "dialog" && role === "button" && noteOpen && matches("Send invitation")) return "Send invitation";
      if (scope === "menu" && role === "button" && menuOpen && sent && pendingInMenu && matches("Pending")) return "Pending";
      return null;
    },
    controlName: async (control) => String(control),
    controlHref: async () => null,
    click: async (control) => {
      const label = String(control);
      if (label === "More") menuOpen = true;
      if (label === "Connect") {
        menuOpen = false;
        dialogOpen = true;
      }
      if (label === "Add a note") noteOpen = true;
      if (label === "Send invitation") sent = true;
    },
    fill: async () => undefined,
    dialogText: async () => sent ? null : "Add a note to your invitation to Ada",
    findInviteLinks: async () => [],
    describeInviteControls: async () => "fake controls",
  };
}

function sendingInvite() {
  const item = createOutboxItem(state.store, {
    name: "Ada Lovelace",
    profileUrl,
    text: "Hello Ada",
    kind: "invite",
    createdBy: "operator",
  });
  approveOutboxItems(state.store, { ids: [item.id] });
  item.status = "sending";
  return item;
}

describe("direct Outbox confirmation from More", () => {
  beforeEach(() => {
    state.store = createSeedStore();
    state.store.settings.linkedinSendWindowStart = "09:00";
    state.store.settings.linkedinSendWindowEnd = "09:00";
    state.store.settings.linkedinActionGapMinSeconds = 0;
    state.store.settings.linkedinActionGapMaxSeconds = 0;
  });

  it("records a sent invite when Pending appears in the More menu", async () => {
    const item = sendingInvite();

    const result = await sendInviteDirect(item.id, fake(true));

    expect(result).toMatchObject({ outcome: "sent", itemId: item.id });
    expect(state.store.linkedinSendLog?.filter((entry) =>
      entry.kind === "invite" && entry.outboxItemId === item.id
    )).toHaveLength(1);
  });

  it("stops without recording a send when Pending is absent from the card and menu", async () => {
    const item = sendingInvite();

    const result = await sendInviteDirect(item.id, fake(false));

    expect(result.outcome === "stopped" && result.reason).toMatch(
      /^No Pending button appeared; the invitation may have been sent\./
    );
    expect(state.store.linkedinSendLog ?? []).toHaveLength(0);
  });
});
