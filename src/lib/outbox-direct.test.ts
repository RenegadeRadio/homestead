import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));
const handleUserMessage = vi.hoisted(() =>
  vi.fn<(input: { text: string }) => Promise<void>>(async () => undefined)
);

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) => fn(state.store)),
}));
vi.mock("@/lib/agent/run", () => ({ handleUserMessage }));
vi.mock("@/lib/outbox-aftermath", () => ({ measureOutboxAftermath: vi.fn(async () => undefined) }));

import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { outboxDirectSettled, startNextOutboxItem } from "@/lib/outbox-bot";
import { setOutboxDirectDeps, type OutboxDirectDeps } from "@/lib/outbox-direct";
import { createSeedStore } from "@/lib/seed";

function fake(options: {
  controls?: string;
  dialogName?: string;
  pageUrl?: string;
  landingUrl?: string;
  noAddNote?: "dialog-only-missing" | "none";
  mainInvites?: string[];
  menuRole?: "button" | "link";
  menuConnect?: string;
  ignoreConnectNameFilter?: boolean;
} = {}) {
  const clicks: string[] = [];
  const typed: string[] = [];
  const navigations: string[] = [];
  let menuOpen = false;
  let dialogOpen = false;
  let noteOpen = false;
  let sent = false;
  const deps: OutboxDirectDeps = {
    now: () => new Date("2026-09-23T10:00:00.000Z"),
    sleep: async () => undefined,
    navigate: async (url) => {
      navigations.push(url);
      return { url: options.landingUrl ?? url, gateNeeded: false, gateReason: "" };
    },
    pageUrl: async () => options.pageUrl ?? options.landingUrl ?? navigations.at(-1) ?? "",
    pageText: async () => "",
    waitForControl: async ({ scope, role, name }) => {
      const matches = (label: string) => !name || name.test(label);
      if (scope === "main" && role === "button" && !menuOpen) {
        const invite = options.mainInvites?.find((label) => options.ignoreConnectNameFilter || matches(label));
        if (invite) return invite;
      }
      if (scope === "main" && role === "button" && !menuOpen && matches("More")) return "More";
      const menuConnect = options.menuConnect ?? "Connect";
      if (scope === "menu" && role === (options.menuRole ?? "button") && menuOpen
        && (options.ignoreConnectNameFilter || matches(menuConnect))) return menuConnect;
      if (scope === "dialog" && role === "button" && dialogOpen && !noteOpen && !options.noAddNote && matches("Add a note")) return "Add a note";
      if (scope === "page" && role === "button" && dialogOpen && !noteOpen && options.noAddNote !== "none" && matches("Add a note")) return "Add a note";
      if (scope === "dialog" && role === "textbox" && noteOpen) return "textbox";
      if (scope === "dialog" && role === "button" && noteOpen && matches("Send invitation")) return "Send invitation";
      if (scope === "main" && role === "button" && sent && matches("Pending")) return "Pending";
      return null;
    },
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
    fill: async (_control, text) => { typed.push(text); },
    dialogText: async () => `Add a note to your invitation to ${options.dialogName ?? "Ada"}`,
    findInviteLinks: async () => [],
    describeInviteControls: async () => options.controls ?? "fake controls",
  };
  return { deps, clicks, typed, navigations };
}

function approvedInvite(name = "Ada Lovelace") {
  const item = createOutboxItem(state.store, {
    name,
    profileUrl: "https://www.linkedin.com/in/ada-lovelace",
    text: "Hello Ada",
    kind: "invite",
    createdBy: "operator",
  });
  approveOutboxItems(state.store, { ids: [item.id] });
  return item;
}

describe("direct Outbox invites", () => {
  beforeEach(() => {
    state.store = createSeedStore();
    state.store.settings.linkedinSendWindowStart = "09:00";
    state.store.settings.linkedinSendWindowEnd = "09:00";
    state.store.settings.linkedinActionGapMinSeconds = 0;
    state.store.settings.linkedinActionGapMaxSeconds = 0;
    state.store.settings.outboxDirectInvites = true;
    vi.clearAllMocks();
  });

  afterEach(() => setOutboxDirectDeps(null));

  it("sends an approved invite through More with one load and four named clicks", async () => {
    const item = approvedInvite();
    const page = fake();
    setOutboxDirectDeps(page.deps);

    await startNextOutboxItem();
    await outboxDirectSettled();

    expect(page.navigations).toEqual([item.profileUrl]);
    expect(state.store.settings.linkedinPageLoads).toHaveLength(1);
    expect(page.clicks).toEqual(["More", "Connect", "Add a note", "Send invitation"]);
    expect(page.typed).toEqual([item.text]);
    expect(item.status).toBe("sent");
    expect(handleUserMessage).not.toHaveBeenCalled();
    expect(state.store.linkedinSendLog?.some((entry) => entry.kind === "invite" && entry.outboxItemId === item.id)).toBe(true);
  });

  it("ignores another person's main invite and uses the menu link", async () => {
    const item = approvedInvite();
    const page = fake({
      mainInvites: ["Invite Grace Hopper to connect"],
      menuRole: "link",
    });
    setOutboxDirectDeps(page.deps);

    await startNextOutboxItem();
    await outboxDirectSettled();

    expect(page.clicks).toEqual(["More", "Connect", "Add a note", "Send invitation"]);
    expect(page.clicks).not.toContain("Invite Grace Hopper to connect");
    expect(item.status).toBe("sent");
  });

  it("ignores a main invite for someone with the same first name", async () => {
    const item = approvedInvite();
    const page = fake({ mainInvites: ["Invite Ada Byron to connect"], menuRole: "link" });
    setOutboxDirectDeps(page.deps);

    await startNextOutboxItem();
    await outboxDirectSettled();

    expect(page.clicks).toEqual(["More", "Connect", "Add a note", "Send invitation"]);
    expect(page.clicks).not.toContain("Invite Ada Byron to connect");
    expect(item.status).toBe("sent");
  });

  it("drops a title when matching a main invite", async () => {
    const item = approvedInvite("Dr Ada Lovelace");
    const page = fake({ mainInvites: ["Invite Ada Lovelace to connect"], dialogName: "Dr Ada" });
    setOutboxDirectDeps(page.deps);

    await startNextOutboxItem();
    await outboxDirectSettled();

    expect(page.clicks[0]).toBe("Invite Ada Lovelace to connect");
    expect(page.clicks).not.toContain("More");
    expect(item.status).toBe("sent");
  });

  it("allows middle names and trailing emoji in a main invite", async () => {
    const item = approvedInvite();
    const label = "Invite Ada Augusta Lovelace 🇬🇧 to connect";
    const page = fake({ mainInvites: [label] });
    setOutboxDirectDeps(page.deps);

    await startNextOutboxItem();
    await outboxDirectSettled();

    expect(page.clicks[0]).toBe(label);
    expect(item.status).toBe("sent");
  });

  it.each([
    ["Jozef Hruška", "Invite Jozef Hruska to connect", "Jozef"],
    ["Claire O'Sullivan", "Invite Claire O’Sullivan to connect", "Claire"],
  ])("normalises accents and apostrophes for %s", async (name, label, dialogName) => {
    const item = approvedInvite(name);
    const page = fake({ mainInvites: [label], dialogName });
    setOutboxDirectDeps(page.deps);

    await startNextOutboxItem();
    await outboxDirectSettled();

    expect(page.clicks[0]).toBe(label);
    expect(item.status).toBe("sent");
  });

  it("stops before looking for controls when only one name remains after the title", async () => {
    approvedInvite("Dr Ada");
    const page = fake({ mainInvites: ["Invite Ada Byron to connect"] });
    setOutboxDirectDeps(page.deps);

    await startNextOutboxItem();
    await outboxDirectSettled();

    expect(page.clicks).toEqual([]);
    expect(handleUserMessage.mock.calls[0][0].text).toMatch(/^Outbox direct send stopped at connect:/);
  });

  it("stops and starts the Bot when only another person's invite controls exist", async () => {
    approvedInvite();
    const page = fake({
      mainInvites: ["Invite Grace Hopper to connect"],
      menuConnect: "Invite Grace Hopper to connect",
      ignoreConnectNameFilter: true,
    });
    setOutboxDirectDeps(page.deps);

    await startNextOutboxItem();
    await outboxDirectSettled();

    expect(page.clicks).not.toContain("Invite Grace Hopper to connect");
    expect(handleUserMessage).toHaveBeenCalledOnce();
    const summary = state.store.computerLogs.find((log) =>
      log.summary.startsWith("Outbox direct send stopped at connect:")
    )?.summary;
    expect(summary).toContain(" Clicked: ");
  });

  it("logs every clicked control in order after a successful send", async () => {
    approvedInvite();
    const page = fake();
    setOutboxDirectDeps(page.deps);

    await startNextOutboxItem();
    await outboxDirectSettled();

    const summary = state.store.computerLogs.find((log) =>
      log.summary.startsWith("LinkedIn invite recorded:")
    )?.summary;
    expect(summary).toMatch(/Clicked: More, Connect, Add a note, Send invitation$/);
  });

  it("falls back to the page-scoped Add a note button", async () => {
    const item = approvedInvite();
    const page = fake({ noAddNote: "dialog-only-missing" });
    setOutboxDirectDeps(page.deps);

    await startNextOutboxItem();
    await outboxDirectSettled();

    expect(page.clicks).toEqual(["More", "Connect", "Add a note", "Send invitation"]);
    expect(item.status).toBe("sent");
    expect(handleUserMessage).not.toHaveBeenCalled();
  });

  it("logs visible controls and starts the Bot when Add a note is absent", async () => {
    approvedInvite();
    const page = fake({ noAddNote: "none", controls: "MARKER-CONTROLS" });
    setOutboxDirectDeps(page.deps);

    await startNextOutboxItem();
    await outboxDirectSettled();

    const summary = state.store.computerLogs.find((log) =>
      log.summary.startsWith("Outbox direct send stopped at add-note:")
    )?.summary;
    expect(summary).toContain("MARKER-CONTROLS");
    expect(handleUserMessage).toHaveBeenCalledOnce();
    expect(handleUserMessage.mock.calls[0][0].text).toMatch(/^Outbox direct send stopped at add-note:/);
  });

  it("keeps the name guard after using the page-scoped Add a note button", async () => {
    approvedInvite();
    const page = fake({
      noAddNote: "dialog-only-missing",
      dialogName: "Grace",
      pageUrl: "https://www.linkedin.com/in/grace-hopper",
    });
    setOutboxDirectDeps(page.deps);

    await startNextOutboxItem();
    await outboxDirectSettled();

    expect(page.typed).toEqual([]);
    expect(handleUserMessage.mock.calls[0][0].text).toMatch(/^Outbox direct send stopped at name-check:/);
    expect(state.store.computerLogs.some((log) =>
      log.summary.startsWith("Outbox direct send stopped at name-check:")
    )).toBe(true);
  });

  it("hands a mismatched dialog to the Bot without typing", async () => {
    approvedInvite();
    const page = fake({ dialogName: "Grace", pageUrl: "https://www.linkedin.com/in/grace-hopper" });
    setOutboxDirectDeps(page.deps);

    await startNextOutboxItem();
    await outboxDirectSettled();

    expect(page.typed).toEqual([]);
    expect(handleUserMessage).toHaveBeenCalledOnce();
    expect(handleUserMessage.mock.calls[0][0].text).toMatch(/^Outbox direct send stopped at name-check:/);
    expect(state.store.computerLogs.some((log) => log.summary.startsWith("Outbox direct send stopped at"))).toBe(true);
  });

  it("sets a hold on authwall without clicking or starting the Bot", async () => {
    const item = approvedInvite();
    const page = fake({ landingUrl: "https://www.linkedin.com/authwall?x=1" });
    setOutboxDirectDeps(page.deps);

    await startNextOutboxItem();
    await outboxDirectSettled();

    expect(state.store.settings.linkedinHold).toContain("automatic:");
    expect(page.clicks).toEqual([]);
    expect(handleUserMessage).not.toHaveBeenCalled();
    expect(item.status).not.toBe("sent");
  });

  it("keeps the Bot path when the setting is off or the item is a message", async () => {
    state.store.settings.outboxDirectInvites = false;
    approvedInvite();
    await startNextOutboxItem();
    expect(handleUserMessage).toHaveBeenCalledOnce();

    state.store = createSeedStore();
    state.store.settings.linkedinSendWindowStart = "09:00";
    state.store.settings.linkedinSendWindowEnd = "09:00";
    state.store.settings.outboxDirectInvites = true;
    handleUserMessage.mockClear();
    const message = createOutboxItem(state.store, {
      name: "Ada Lovelace", profileUrl: "https://www.linkedin.com/in/ada-lovelace",
      text: "Hello Ada", kind: "message", createdBy: "operator",
    });
    approveOutboxItems(state.store, { ids: [message.id] });
    await startNextOutboxItem();
    expect(handleUserMessage).toHaveBeenCalledOnce();
  });

  it("does not load or hand off when a LinkedIn hold already exists", async () => {
    const item = approvedInvite();
    state.store.settings.linkedinHold = "operator hold";
    const page = fake();
    setOutboxDirectDeps(page.deps);

    await startNextOutboxItem();
    await outboxDirectSettled();

    expect(page.navigations).toEqual([]);
    expect(handleUserMessage).not.toHaveBeenCalled();
    expect(item.status).toBe("sending");
  });

  it("stops before typing when approved text has changed", async () => {
    const item = approvedInvite();
    item.text = "Changed after approval";
    const page = fake();
    setOutboxDirectDeps(page.deps);

    await startNextOutboxItem();
    await outboxDirectSettled();

    expect(page.typed).toEqual([]);
    expect(handleUserMessage.mock.calls[0][0].text).toMatch(/^Outbox direct send stopped at type:/);
  });
});
