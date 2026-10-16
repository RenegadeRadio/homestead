import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) => fn(state.store)),
}));

import {
  forgetTypedText,
  rememberTypedText,
  typedTextFor,
} from "@/lib/agent/linkedin-send-log";
import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { sendInviteDirect, type OutboxDirectDeps } from "@/lib/outbox-direct";
import { createSeedStore } from "@/lib/seed";

const profileUrl = "https://www.linkedin.com/in/ada-lovelace";

function fake(options: {
  noPending?: boolean;
  noSend?: boolean;
  dialogAfterSend?: string | null;
} = {}) {
  let menuOpen = false;
  let dialogOpen = false;
  let noteOpen = false;
  let sent = false;
  const deps: OutboxDirectDeps = {
    now: () => new Date("2026-09-23T10:00:00.000Z"),
    sleep: async () => undefined,
    navigate: async (url) => ({ url, gateNeeded: false, gateReason: "" }),
    pageUrl: async () => profileUrl,
    pageText: async () => "",
    waitForControl: async ({ scope, role, name }) => {
      const matches = (label: string) => !name || name.test(label);
      if (scope === "main" && role === "button" && !menuOpen && matches("More")) return "More";
      if (scope === "menu" && role === "button" && menuOpen && matches("Connect")) return "Connect";
      if (scope === "dialog" && role === "button" && dialogOpen && !noteOpen && matches("Add a note")) return "Add a note";
      if (scope === "dialog" && role === "textbox" && noteOpen) return "textbox";
      if (scope === "dialog" && role === "button" && noteOpen && !options.noSend && matches("Send invitation")) return "Send invitation";
      if (scope === "main" && role === "button" && sent && !options.noPending && matches("Pending")) return "Pending";
      return null;
    },
    controlName: async (control) => String(control),
    controlHref: async () => null,
    click: async (control) => {
      const label = String(control);
      if (label === "More") menuOpen = true;
      if (label === "Connect") dialogOpen = true;
      if (label === "Add a note") noteOpen = true;
      if (label === "Send invitation") sent = true;
    },
    fill: async () => undefined,
    dialogText: async () => sent
      ? (options.dialogAfterSend ?? null)
      : "Add a note to your invitation to Ada",
    findInviteLinks: async () => [],
    describeInviteControls: async () => "fake controls",
  };
  return deps;
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

describe("direct Outbox typed text cleanup", () => {
  beforeEach(() => {
    state.store = createSeedStore();
    state.store.settings.linkedinSendWindowStart = "09:00";
    state.store.settings.linkedinSendWindowEnd = "09:00";
    state.store.settings.linkedinActionGapMinSeconds = 0;
    state.store.settings.linkedinActionGapMaxSeconds = 0;
    forgetTypedText(profileUrl);
  });

  it("forgets the typed note when confirmation stops without a Pending button", async () => {
    const item = sendingInvite();

    const result = await sendInviteDirect(item.id, fake({ noPending: true }));

    expect(result).toMatchObject({ outcome: "stopped", step: "confirm" });
    expect(typedTextFor(item.profileUrl)).toBe("");
  });

  it("forgets the typed note when sending stops without a Send button", async () => {
    const item = sendingInvite();

    const result = await sendInviteDirect(item.id, fake({ noSend: true }));

    expect(result).toMatchObject({ outcome: "stopped", step: "send" });
    expect(typedTextFor(item.profileUrl)).toBe("");
  });

  it("counts follow-up typing on its own after a confirmation stop", async () => {
    const item = sendingInvite();
    await sendInviteDirect(item.id, fake({ noPending: true }));

    rememberTypedText(item.profileUrl, item.text);

    expect(typedTextFor(item.profileUrl)).toBe(item.text);
  });

  it.each([
    ["open", "Invitation dialog", "yes"],
    ["closed", null, "no"],
  ])("reports when the dialog is %s after confirmation stops", async (_state, dialogAfterSend, expected) => {
    const item = sendingInvite();

    const result = await sendInviteDirect(item.id, fake({ noPending: true, dialogAfterSend }));

    expect(result.outcome === "stopped" && result.reason).toMatch(
      new RegExp(`^No Pending button appeared; the invitation may have been sent\\. Dialog still open: ${expected}\\.`)
    );
  });
});
