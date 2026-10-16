import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) => fn(state.store)),
}));

import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { sendInviteDirect, type DirectControl, type OutboxDirectDeps } from "@/lib/outbox-direct";
import { createSeedStore } from "@/lib/seed";

type InviteLink = { id: string; label: string; href: string | null };

function fake(inviteLinks: InviteLink[]) {
  const clicks: string[] = [];
  let menuOpen = false;
  let dialogOpen = false;
  let noteOpen = false;
  let sent = false;
  const labelOf = (control: DirectControl) =>
    typeof control === "object" && control !== null && "label" in control
      ? String(control.label)
      : String(control);
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
    controlName: async (control) => labelOf(control),
    controlHref: async (control) =>
      typeof control === "object" && control !== null && "href" in control
        ? String(control.href ?? "") || null
        : null,
    click: async (control) => {
      const label = labelOf(control);
      const id = typeof control === "object" && control !== null && "id" in control
        ? String(control.id)
        : label;
      clicks.push(id);
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

describe("direct Outbox invite link href identity", () => {
  beforeEach(() => {
    state.store = createSeedStore();
    state.store.settings.linkedinSendWindowStart = "09:00";
    state.store.settings.linkedinSendWindowEnd = "09:00";
    state.store.settings.linkedinActionGapMinSeconds = 0;
    state.store.settings.linkedinActionGapMaxSeconds = 0;
  });

  it("uses one of two links whose vanityName identifies the invitee", async () => {
    const item = sendingInvite();
    const label = "Invite Ada Lovelace to connect";
    const href = "/preload/custom-invite/?vanityName=ada-lovelace";
    const page = fake([{ id: "first-link", label, href }, { id: "second-link", label, href }]);

    const result = await sendInviteDirect(item.id, page.deps);

    expect(result.outcome).toBe("sent");
    expect(page.clicks.slice(0, 3)).toEqual(["More", "first-link", "Add a note"]);
  });

  it("presses neither link when one vanityName identifies someone else", async () => {
    const item = sendingInvite();
    const label = "Invite Ada Lovelace to connect";
    const page = fake([
      { id: "first-link", label, href: "/preload/custom-invite/?vanityName=ada-lovelace" },
      { id: "second-link", label, href: "/preload/custom-invite/?vanityName=someone-else" },
    ]);

    const result = await sendInviteDirect(item.id, page.deps);

    expect(result.outcome === "stopped" && result.reason).toContain("points to someone other than");
    expect(page.clicks).toEqual(["More"]);
  });

  it("uses a bare Connect link whose vanityName identifies the invitee", async () => {
    const item = sendingInvite();
    const page = fake([
      { id: "connect-link", label: "Connect", href: "/preload/custom-invite/?vanityName=ada-lovelace" },
    ]);

    const result = await sendInviteDirect(item.id, page.deps);

    expect(result.outcome).toBe("sent");
    expect(page.clicks.slice(0, 3)).toEqual(["More", "connect-link", "Add a note"]);
  });

  it("keeps the ambiguous-link behavior when hrefs are unavailable", async () => {
    const item = sendingInvite();
    const label = "Invite Ada Lovelace to connect";
    const page = fake([
      { id: "first-link", label, href: null },
      { id: "second-link", label, href: null },
    ]);

    const result = await sendInviteDirect(item.id, page.deps);

    expect(result.outcome === "stopped" && result.reason).toContain("More than one Connect link");
    expect(page.clicks).toEqual(["More"]);
  });
});
