import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) => fn(state.store)),
}));

import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { sendInviteDirect, type OutboxDirectDeps } from "@/lib/outbox-direct";
import { createSeedStore } from "@/lib/seed";

function fake(inviteLinks: string[]) {
  const clicks: string[] = [];
  let menuOpen = false;
  let dialogOpen = false;
  let noteOpen = false;
  let sent = false;
  const deps: OutboxDirectDeps = {
    now: () => new Date("2026-09-23T10:00:00.000Z"),
    sleep: async () => undefined,
    navigate: async (url) => ({ url, gateNeeded: false, gateReason: "" }),
    pageUrl: async () => "https://www.linkedin.com/in/ada-lovelace",
    pageText: async () => "",
    waitForControl: async ({ scope, role, name }) => {
      const matches = (label: string) => !name || name.test(label);
      if (scope === "main" && role === "button" && !menuOpen && matches("More")) return "More";
      if (scope === "dialog" && role === "button" && dialogOpen && !noteOpen && matches("Add a note")) return "Add a note";
      if (scope === "dialog" && role === "textbox" && noteOpen) return "textbox";
      if (scope === "dialog" && role === "button" && noteOpen && matches("Send invitation")) return "Send invitation";
      if (scope === "main" && role === "button" && sent && matches("Pending")) return "Pending";
      return null;
    },
    findInviteLinks: async () => menuOpen ? inviteLinks : [],
    controlName: async (control) => String(control),
    controlHref: async () => null,
    click: async (control) => {
      const label = String(control);
      clicks.push(label);
      if (label === "More") menuOpen = true;
      if (label === "Connect" || /^Invite\b.*to connect$/i.test(label)) dialogOpen = true;
      if (label === "Add a note") noteOpen = true;
      if (label === "Send invitation") sent = true;
    },
    fill: async () => undefined,
    dialogText: async () => "Add a note to your invitation to Ada",
    describeInviteControls: async () => "fake controls",
  };
  return { deps, clicks };
}

function sendingInvite() {
  const item = createOutboxItem(state.store, {
    name: "Ada Lovelace",
    profileUrl: "https://www.linkedin.com/in/ada-lovelace",
    text: "Hello Ada",
    kind: "invite",
    createdBy: "operator",
  });
  approveOutboxItems(state.store, { ids: [item.id] });
  item.status = "sending";
  return item;
}

describe("direct Outbox invite links outside the More menu scope", () => {
  beforeEach(() => {
    state.store = createSeedStore();
    state.store.settings.linkedinSendWindowStart = "09:00";
    state.store.settings.linkedinSendWindowEnd = "09:00";
    state.store.settings.linkedinActionGapMinSeconds = 0;
    state.store.settings.linkedinActionGapMaxSeconds = 0;
  });

  it.each([
    "Connect",
    "Invite Ada Lovelace to connect",
  ])("uses the page-wide invite link named %s and reaches Add a note", async (label) => {
    const item = sendingInvite();
    const page = fake([label]);

    const result = await sendInviteDirect(item.id, page.deps);

    expect(result.outcome).toBe("sent");
    expect(page.clicks.slice(0, 3)).toEqual(["More", label, "Add a note"]);
  });

  it("does not press an invite link naming someone else", async () => {
    const item = sendingInvite();
    const page = fake(["Invite Someone Else to connect"]);

    const result = await sendInviteDirect(item.id, page.deps);

    expect(result).toMatchObject({ outcome: "stopped" });
    expect(result.outcome === "stopped" && result.reason).toContain("names someone other than");
    expect(page.clicks).toEqual(["More"]);
  });

  it("does not press either of two invite links", async () => {
    const item = sendingInvite();
    const page = fake(["Connect", "Invite Ada Lovelace to connect"]);

    const result = await sendInviteDirect(item.id, page.deps);

    expect(result.outcome === "stopped" && result.reason).toContain("More than one Connect link");
    expect(page.clicks).toEqual(["More"]);
  });

  it("keeps the existing missing-control message when no invite links exist", async () => {
    const item = sendingInvite();
    const page = fake([]);

    const result = await sendInviteDirect(item.id, page.deps);

    expect(result.outcome === "stopped" && result.reason).toMatch(/^No Connect control for/);
    expect(page.clicks).toEqual(["More"]);
  });
});
