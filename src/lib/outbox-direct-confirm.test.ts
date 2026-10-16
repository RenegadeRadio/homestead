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

function fake(options: { pageText?: string; pendingPage?: boolean } = {}): OutboxDirectDeps {
  let menuOpen = false;
  let dialogOpen = false;
  let noteOpen = false;
  let sent = false;
  return {
    now: () => new Date("2026-10-05T10:00:00.000Z"),
    sleep: async () => undefined,
    navigate: async (url) => ({ url, gateNeeded: false, gateReason: "" }),
    pageUrl: async () => profileUrl,
    pageText: async () => sent ? options.pageText ?? "" : "",
    waitForControl: async ({ scope, role, name }) => {
      const matches = (label: string) => !name || name.test(label);
      if (scope === "main" && role === "button" && !menuOpen && matches("More")) return "More";
      if (scope === "menu" && role === "button" && menuOpen && !sent && matches("Connect")) return "Connect";
      if (scope === "dialog" && role === "button" && dialogOpen && !noteOpen && matches("Add a note")) return "Add a note";
      if (scope === "dialog" && role === "textbox" && noteOpen) return "textbox";
      if (scope === "dialog" && role === "button" && noteOpen && matches("Send invitation")) return "Send invitation";
      if (scope === "page" && role === "menuitem" && menuOpen && sent && options.pendingPage && matches("Pending")) {
        return "Pending";
      }
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

function recordedLog(): string {
  return state.store.computerLogs.find((log) => log.summary.startsWith("LinkedIn invite recorded:"))?.summary ?? "";
}

describe("direct Outbox send confirmation", () => {
  beforeEach(() => {
    state.store = createSeedStore();
    state.store.settings.linkedinSendWindowStart = "09:00";
    state.store.settings.linkedinSendWindowEnd = "09:00";
    state.store.settings.linkedinActionGapMinSeconds = 0;
    state.store.settings.linkedinActionGapMaxSeconds = 0;
  });

  it("records a sent invite from the Invitation sent toast", async () => {
    const item = sendingInvite();

    const result = await sendInviteDirect(item.id, fake({ pageText: "Invitation sent to Ada" }));

    expect(result).toMatchObject({ outcome: "sent", itemId: item.id });
    expect(item.status).toBe("sent");
    expect(state.store.linkedinSendLog?.filter((entry) => entry.outboxItemId === item.id)).toHaveLength(1);
    expect(recordedLog()).toContain("Confirmed by: toast.");
  });

  it("records a sent invite from a page-scoped Pending menuitem", async () => {
    const item = sendingInvite();

    const result = await sendInviteDirect(item.id, fake({ pendingPage: true }));

    expect(result).toMatchObject({ outcome: "sent", itemId: item.id });
    expect(item.status).toBe("sent");
    expect(recordedLog()).toContain("Confirmed by: pending-page.");
  });

  it("stops without recording when no confirmation signal exists", async () => {
    const item = sendingInvite();

    const result = await sendInviteDirect(item.id, fake());

    expect(result).toMatchObject({ outcome: "stopped", step: "confirm" });
    expect(result.outcome === "stopped" && result.reason).toContain("Checked: toast, main, menu, page.");
    expect(item.status).not.toBe("sent");
    expect(state.store.linkedinSendLog ?? []).toHaveLength(0);
  });

  it("lets a weekly-limit refusal win over the Invitation sent toast", async () => {
    const item = sendingInvite();
    const text = "Invitation sent. You have reached the weekly limit for connection invitations.";

    const result = await sendInviteDirect(item.id, fake({ pageText: text }));

    expect(result).toMatchObject({ outcome: "refused" });
    expect(item.status).toBe("approved");
    expect(state.store.linkedinSendLog ?? []).toHaveLength(0);
  });
});
