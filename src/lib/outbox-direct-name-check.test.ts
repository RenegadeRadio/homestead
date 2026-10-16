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
  dialogText: () => Promise<string | null>;
  pageUrl: () => Promise<string>;
}) {
  const clicks: string[] = [];
  const typed: string[] = [];
  let menuOpen = false;
  let dialogOpen = false;
  let noteOpen = false;
  let sent = false;
  const deps: OutboxDirectDeps = {
    now: () => new Date("2026-09-26T10:00:00.000Z"),
    sleep: async () => undefined,
    navigate: async (url) => ({ url, gateNeeded: false, gateReason: "" }),
    pageUrl: options.pageUrl,
    pageText: async () => "",
    waitForControl: async ({ scope, role, name }) => {
      const matches = (label: string) => !name || name.test(label);
      if (scope === "main" && role === "button" && !menuOpen && matches("More")) return "More";
      if (scope === "menu" && role === "button" && menuOpen && matches("Connect")) return "Connect";
      if (scope === "dialog" && role === "button" && dialogOpen && !noteOpen && matches("Add a note")) return "Add a note";
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
      if (label === "Connect") dialogOpen = true;
      if (label === "Add a note") noteOpen = true;
      if (label === "Send invitation") sent = true;
    },
    fill: async (_control, text) => { typed.push(text); },
    dialogText: options.dialogText,
    findInviteLinks: async () => [],
    describeInviteControls: async () => "fake controls",
  };
  return { deps, clicks, typed };
}

function approvedInvite() {
  const item = createOutboxItem(state.store, {
    name: "Ada Lovelace",
    profileUrl: "https://www.linkedin.com/in/ada-lovelace",
    text: "Hello Ada",
    kind: "invite",
    createdBy: "operator",
  });
  approveOutboxItems(state.store, { ids: [item.id] });
  return item;
}

async function run(page: ReturnType<typeof fake>) {
  setOutboxDirectDeps(page.deps);
  await startNextOutboxItem();
  await outboxDirectSettled();
}

describe("direct Outbox invite name check", () => {
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

  it("accepts a nameless dialog on the invitee's own profile", async () => {
    const item = approvedInvite();
    const page = fake({
      dialogText: async () => "Dismiss Cancel adding a note Send invitation",
      pageUrl: async () => "https://www.linkedin.com/in/ada-lovelace/",
    });

    await run(page);

    expect(page.typed).toEqual([item.text]);
    expect(page.clicks.at(-1)).toBe("Send invitation");
    expect(item.status).toBe("sent");
  });

  it("rejects a nameless dialog on another person's profile", async () => {
    approvedInvite();
    const page = fake({
      dialogText: async () => "Dismiss Cancel adding a note Send invitation",
      pageUrl: async () => "https://www.linkedin.com/in/grace-hopper",
    });

    await run(page);

    expect(page.typed).toEqual([]);
    const message = handleUserMessage.mock.calls[0][0].text;
    expect(message).toMatch(/^Outbox direct send stopped at name-check: The note dialog does not name Ada\./);
    expect(message).toContain("Dialog text:");
  });

  it("retries until the dialog text names the invitee", async () => {
    const item = approvedInvite();
    const dialogText = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue("Add a note to your invitation to Ada");
    const page = fake({
      dialogText,
      pageUrl: async () => "https://www.linkedin.com/in/grace-hopper",
    });

    await run(page);

    expect(page.typed).toEqual([item.text]);
    expect(dialogText).toHaveBeenCalledTimes(3);
    expect(item.status).toBe("sent");
  });

  it("rejects a persistently missing dialog even on the invitee's own profile", async () => {
    approvedInvite();
    const dialogText = vi.fn(async () => null);
    const pageUrl = vi.fn(async () => "https://www.linkedin.com/in/ada-lovelace");
    const page = fake({ dialogText, pageUrl });

    await run(page);

    expect(page.typed).toEqual([]);
    const message = handleUserMessage.mock.calls[0][0].text;
    expect(message).toMatch(/^Outbox direct send stopped at name-check: The note dialog does not name Ada\./);
    expect(message).toContain("No single note dialog with a text box was found");
    expect(dialogText).toHaveBeenCalledTimes(21);
    expect(pageUrl).not.toHaveBeenCalled();
  });
});
