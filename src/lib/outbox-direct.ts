import type { Locator } from "playwright";

import {
  browserNavigate,
  composeDialogText,
  ensureBrowser,
  withBrowserLock,
} from "@/lib/browser";
import {
  automaticLinkedInHoldReason,
  checkLinkedInHold,
  findLinkedInInviteRefusal,
  pauseLinkedInInvites,
  checkLinkedInPageBudget,
  DEFAULT_LINKEDIN_DAILY_PAGE_LOADS,
  pruneLinkedInPageLoads,
  recordLinkedInPageLoad,
  scheduleNextLinkedInAction,
  waitForLinkedInActionGap,
} from "@/lib/agent/linkedin-budget";
import { isLinkedInUrl, noteLinkedInSendPaced } from "@/lib/agent/linkedin-pacing";
import {
  forgetTypedText,
  linkedInProfileSlug,
  recordLinkedInSend,
  rememberTypedText,
} from "@/lib/agent/linkedin-send-log";
import { nid, nowIso } from "@/lib/ids";
import { sha256Hex } from "@/lib/outbox";
import { getStore, updateStore } from "@/lib/store";

export const MORE_NAME = /^More$/;
export const CONNECT_NAME = /^(Connect|Invite\b.*to connect)$/i;
export const ADD_NOTE_NAME = /^Add a note$/;
export const SEND_INVITATION_NAME = /^Send invitation$/;
export const SEND_NAME = /^Send$/;
export const PENDING_NAME = /^Pending/;

const NAME_CHECK_READ_INTERVAL_MS = 250;
const NAME_CHECK_MAX_RETRIES = 20;

export type DirectControl = unknown;
export type ControlQuery = {
  scope: "main" | "menu" | "dialog" | "page";
  role: "button" | "link" | "textbox" | "menuitem";
  name?: RegExp;
  timeoutMs: number;
};

export interface OutboxDirectDeps {
  navigate(url: string): Promise<
    | { blocked: true; reason: string }
    | { blocked?: false; url: string; gateNeeded: boolean; gateReason: string }
  >;
  pageUrl(): Promise<string>;
  pageText(): Promise<string>;
  waitForControl(query: ControlQuery): Promise<DirectControl | null>;
  controlName(control: DirectControl): Promise<string>;
  controlHref(control: DirectControl): Promise<string | null>;
  click(control: DirectControl): Promise<void>;
  fill(control: DirectControl, text: string): Promise<void>;
  dialogText(): Promise<string | null>;
  findInviteLinks(name: RegExp): Promise<DirectControl[]>;
  describeInviteControls(): Promise<string>;
  now(): Date;
  sleep(ms: number): Promise<void>;
}

async function firstVisible(locator: Locator, timeoutMs: number): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  do {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (true);
}

async function withBotPage<T>(fn: (page: Awaited<ReturnType<typeof ensureBrowser>>["page"]) => Promise<T>): Promise<T> {
  return withBrowserLock(async () => {
    const session = await ensureBrowser();
    if (session.mode === "human") {
      throw new Error("The user has the computer. Wait until they continue.");
    }
    return fn(session.page);
  });
}

export const defaultOutboxDirectDeps: OutboxDirectDeps = {
  navigate: async (url) => {
    const result = await browserNavigate(url);
    if ("blocked" in result && result.blocked) return { blocked: true, reason: result.result };
    return {
      url: result.url,
      gateNeeded: result.gate.needed,
      gateReason: result.gate.reason,
    };
  },
  pageUrl: () => withBotPage(async (page) => page.url()),
  pageText: () => withBotPage(async (page) => page.locator("body").innerText()),
  waitForControl: (query) => withBotPage(async (page) => {
    if (query.scope === "page") {
      return firstVisible(page.getByRole(query.role, query.name ? { name: query.name } : {}), query.timeoutMs);
    }
    const container = query.scope === "main"
      ? page.getByRole("main")
      : query.scope === "menu"
        ? page.locator('[role="menu"]:visible')
        : page.getByRole("dialog");
    return firstVisible(container.getByRole(query.role, query.name ? { name: query.name } : {}), query.timeoutMs);
  }),
  controlName: (control) => withBotPage(async () =>
    (await (control as Locator).getAttribute("aria-label"))?.trim()
      || (await (control as Locator).textContent())?.trim()
      || "unnamed control"
  ),
  controlHref: (control) => withBotPage(async () =>
    (await (control as Locator).getAttribute("href").catch(() => null)) ?? null
  ),
  click: (control) => withBotPage(async () => { await (control as Locator).click(); }),
  fill: (control, text) => withBotPage(async () => { await (control as Locator).fill(text); }),
  dialogText: () => withBotPage(composeDialogText),
  findInviteLinks: (name) => withBotPage(async (page) => {
    const links = page.locator('a[href*="/preload/custom-invite/"]');
    const count = await links.count();
    const found: Locator[] = [];
    for (let index = 0; index < count; index += 1) {
      const link = links.nth(index);
      if (!await link.isVisible().catch(() => false)) continue;
      const linkName = (await link.getAttribute("aria-label").catch(() => null))?.trim()
        || (await link.textContent().catch(() => null))?.trim()
        || "";
      if (name.test(linkName)) found.push(link);
    }
    return found;
  }),
  describeInviteControls: async () => {
    try {
      return await withBotPage(async (page) => {
        const lines: string[] = [];
        const extraLines: string[] = [];
        const inviteLinks = page.locator('a[href*="/preload/custom-invite/"]');
        const inviteLinkCount = Math.min(await inviteLinks.count(), 20);
        for (let index = 0; index < inviteLinkCount; index += 1) {
          const link = inviteLinks.nth(index);
          if (!await link.isVisible().catch(() => false)) continue;
          const name = (await link.getAttribute("aria-label").catch(() => null))?.trim()
            || (await link.textContent().catch(() => null))?.trim()
            || "unnamed link";
          const href = await link.getAttribute("href").catch(() => null);
          extraLines.push(`invite-link: ${name} | href: ${href ?? "none"}`);
        }
        const moreButtons = page.getByRole("button", { name: MORE_NAME });
        const moreCount = Math.min(await moreButtons.count(), 20);
        for (let index = 0; index < moreCount; index += 1) {
          const more = moreButtons.nth(index);
          if (!await more.isVisible().catch(() => false)) continue;
          const expanded = await more.getAttribute("aria-expanded").catch(() => null);
          extraLines.push(`more: aria-expanded=${expanded ?? "none"}`);
        }
        const names = /^(Add a note|Send without a note|Send invitation|Send|Dismiss|More|Connect)$|^Invite\b.*to connect$/i;
        for (const role of ["button", "link"] as const) {
          const controls = page.getByRole(role, { name: names });
          const count = Math.min(await controls.count(), 20);
          for (let index = 0; index < count; index += 1) {
            const control = controls.nth(index);
            if (!await control.isVisible()) continue;
            const name = (await control.getAttribute("aria-label"))?.trim()
              || (await control.textContent())?.trim()
              || `unnamed ${role}`;
            const details = await control.evaluate((element) => {
              const ancestors: string[] = [];
              let current: Node | null = element.parentNode;
              let inShadow = false;
              while (current) {
                if (current instanceof ShadowRoot) {
                  inShadow = true;
                  current = current.host;
                  continue;
                }
                if (!(current instanceof Element)) break;
                let description = current.tagName.toLowerCase();
                const role = current.getAttribute("role");
                const ariaModal = current.getAttribute("aria-modal");
                if (role !== null) description += ` role="${role}"`;
                if (ariaModal !== null) description += ` aria-modal="${ariaModal}"`;
                ancestors.push(description);
                if (current.tagName.toLowerCase() === "body") break;
                current = current.parentNode;
              }
              return { ancestors, inShadow };
            });
            lines.push(`${role}: ${name} | ${details.ancestors.join(" < ")} | shadow: ${details.inShadow ? "yes" : "no"}`);
          }
        }
        const dialog = await page.locator('[role="dialog"]').count();
        const alertdialog = await page.locator('[role="alertdialog"]').count();
        const ariaModal = await page.locator('[aria-modal="true"]').count();
        const counts = `dialog=${dialog} alertdialog=${alertdialog} aria-modal=${ariaModal}`;
        const details = [...extraLines, ...lines].join("\n").slice(0, Math.max(0, 1499 - counts.length));
        return details ? `${details}\n${counts}` : counts;
      });
    } catch {
      return "controls could not be read";
    }
  },
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

let injectedDeps: OutboxDirectDeps | null = null;
export function setOutboxDirectDeps(deps: OutboxDirectDeps | null): void {
  injectedDeps = deps;
}

export type DirectInviteResult =
  | { outcome: "sent"; itemId: string }
  | { outcome: "held" }
  | { outcome: "refused"; reason: string }
  | { outcome: "stopped"; step: string; reason: string };

const APOSTROPHES = /[’‘ʼ`´]/g;
const NAME_LETTER_VARIANTS = (() => {
  const variants = new Map<string, Set<string>>();
  for (const [start, end] of [[0x00c0, 0x024f], [0x1e00, 0x1eff]]) {
    for (let codePoint = start; codePoint <= end; codePoint += 1) {
      const character = String.fromCodePoint(codePoint);
      const base = character.normalize("NFD")[0]?.toLowerCase();
      if (!base || !/^\p{L}$/u.test(base)) continue;
      const set = variants.get(base) ?? new Set<string>([base]);
      set.add(character);
      variants.set(base, set);
    }
  }
  return variants;
})();

function normaliseName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(APOSTROPHES, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function vanityNameOf(href: string | null, base: string): string | null {
  if (!href) return null;
  try {
    const vanityName = new URL(href, base).searchParams.get("vanityName")?.trim();
    return vanityName || null;
  } catch {
    return null;
  }
}

function inviteeNameParts(name: string): { first: string; last: string; full: string } | null {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (/^(?:dr|prof|mr|mrs|ms|miss)\.?$/i.test(words[0] ?? "")) words.shift();
  while (words.length && !/\p{L}/u.test(words.at(-1)!)) words.pop();
  if (words.length < 2) return null;
  return { first: words[0], last: words.at(-1)!, full: words.join(" ") };
}

function regexClassCharacter(character: string): string {
  return character.replace(/[\\\]\-^]/g, "\\$&");
}

function wordPattern(word: string): string {
  return Array.from(normaliseName(word), (character) => {
    if (character === "'") return "['’‘ʼ`´]";
    if (/^\p{L}$/u.test(character)) {
      const variants = Array.from(NAME_LETTER_VARIANTS.get(character) ?? [character]);
      return `[${variants.map(regexClassCharacter).join("")}]\\p{M}*`;
    }
    return character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
}

function inviteControlPattern(first: string, last: string): RegExp {
  const wordCharacter = "[\\p{L}\\p{N}_\\p{M}]";
  return new RegExp(
    `^Invite\\s+${wordPattern(first)}(?!${wordCharacter}).*(?<![\\p{L}\\p{N}_])${wordPattern(last)}(?!${wordCharacter}).*to connect$`,
    "iu"
  );
}

async function stopped(step: string, reason: string): Promise<DirectInviteResult> {
  await updateStore((store) => {
    store.computerLogs.unshift({
      id: nid("log"), at: nowIso(), botId: "outbox", kind: "browser",
      summary: `Outbox direct send stopped at ${step}: ${reason}`,
    });
  });
  return { outcome: "stopped", step, reason };
}

export async function sendInviteDirect(
  itemId: string,
  deps: OutboxDirectDeps = injectedDeps ?? defaultOutboxDirectDeps
): Promise<DirectInviteResult> {
  let step = "navigate";
  let typedUrl: string | null = null;
  const clicked: string[] = [];
  const stop = async (reason: string) => {
    if (typedUrl !== null) forgetTypedText(typedUrl);
    if (["connect", "add-note", "name-check", "type", "send"].includes(step)) {
      let description: string;
      try {
        description = await deps.describeInviteControls();
      } catch {
        description = "controls could not be read";
      }
      reason += ` Page: ${description}`;
    }
    reason += ` Clicked: ${clicked.length ? clicked.join(", ") : "none"}`;
    return stopped(step, reason);
  };
  const act = async <T>(fn: () => Promise<T>): Promise<T> => {
    const before = await getStore();
    await waitForLinkedInActionGap(before.settings, deps.now, undefined, deps.sleep);
    const result = await fn();
    await updateStore((store) => scheduleNextLinkedInAction(store.settings, deps.now()));
    return result;
  };
  const press = async (control: DirectControl, knownName?: string): Promise<void> => {
    const name = knownName ?? await deps.controlName(control);
    clicked.push(name);
    await act(() => deps.click(control));
  };

  try {
    let store = await getStore();
    let item = store.outbox?.find((candidate) => candidate.id === itemId);
    if (!item || item.status !== "sending") return stop("The invite is no longer sending.");
    if (!isLinkedInUrl(item.profileUrl)) return stop("The profile URL is not a LinkedIn URL.");
    const hold = checkLinkedInHold(store.settings);
    if (hold.status === "refused") return { outcome: "held" };
    const now = deps.now();
    const pageLoads = pruneLinkedInPageLoads(store.settings.linkedinPageLoads, now);
    const budget = checkLinkedInPageBudget(now, pageLoads, store.settings.linkedinDailyPageLoads ?? DEFAULT_LINKEDIN_DAILY_PAGE_LOADS);
    await updateStore((current) => { current.settings.linkedinPageLoads = pageLoads; });
    if (budget.status === "refused") return stop(budget.message);

    const navigation = await act(() => deps.navigate(item!.profileUrl));
    if (navigation.blocked) return stop(navigation.reason);
    await updateStore((current) => {
      if (isLinkedInUrl(navigation.url)) recordLinkedInPageLoad(current.settings, deps.now());
    });
    const holdReason = automaticLinkedInHoldReason(navigation.url, navigation.gateNeeded);
    if (holdReason) {
      await updateStore((current) => {
        current.settings.linkedinHold = `${nowIso()} ${holdReason}`;
        current.computerLogs.unshift({
          id: nid("log"), at: nowIso(), botId: "outbox", kind: "browser",
          summary: `LinkedIn hold: ${holdReason}`,
        });
      });
      return { outcome: "held" };
    }

    step = "connect";
    const invitee = inviteeNameParts(item.name);
    if (!invitee) return stop(`The invitee needs a first and last name to match a Connect control: ${item.name}.`);
    const inviteName = inviteControlPattern(invitee.first, invitee.last);
    const menuConnectName = new RegExp(`^(?:Connect|${inviteName.source.slice(1, -1)})$`, inviteName.flags);
    const inviteToConnect = /^Invite\b.*to connect$/i;
    const acceptable = (name: string, allowBare: boolean): "ok" | "skip" | "stop" => {
      const trimmed = name.trim();
      const belongsToInvitee = inviteName.test(normaliseName(trimmed));
      if (inviteToConnect.test(trimmed) && !belongsToInvitee) return "stop";
      if (belongsToInvitee || (allowBare && /^Connect$/i.test(trimmed))) return "ok";
      return "skip";
    };

    let connect = await deps.waitForControl({ scope: "main", role: "button", name: inviteName, timeoutMs: 10_000 });
    let connectName: string | undefined;
    if (connect) {
      connectName = await deps.controlName(connect);
      const verdict = acceptable(connectName, false);
      if (verdict === "stop") return stop(`The Connect control names someone other than ${invitee.full}: ${connectName}.`);
      if (verdict === "skip") connect = null;
    }
    if (!connect) {
      const more = await deps.waitForControl({ scope: "main", role: "button", name: MORE_NAME, timeoutMs: 10_000 });
      if (!more) return stop(`No visible Invite button or More button was found for ${invitee.full}.`);
      const moreName = await deps.controlName(more);
      if (!MORE_NAME.test(moreName.trim())) return stop(`The More control had an unexpected name: ${moreName}.`);
      await press(more, moreName);
      for (const [role, timeoutMs] of [["button", 10_000], ["link", 3_000]] as const) {
        const candidate = await deps.waitForControl({ scope: "menu", role, name: menuConnectName, timeoutMs });
        if (!candidate) continue;
        const candidateName = await deps.controlName(candidate);
        const verdict = acceptable(candidateName, true);
        if (verdict === "stop") return stop(`The Connect control names someone other than ${invitee.full}: ${candidateName}.`);
        if (verdict === "ok") {
          connect = candidate;
          connectName = candidateName;
          break;
        }
      }
      if (!connect) {
        const links = await deps.findInviteLinks(menuConnectName);
        const profileUrl = item.profileUrl;
        const ownSlug = linkedInProfileSlug(profileUrl);
        const vanities = links.length > 0 && ownSlug !== null
          ? await Promise.all(links.map(async (link) => vanityNameOf(await deps.controlHref(link), profileUrl)))
          : [];
        const mismatchedVanity = ownSlug === null
          ? undefined
          : vanities.find((vanity) => vanity !== null && vanity.toLowerCase() !== ownSlug.toLowerCase());
        if (mismatchedVanity) {
          return stop(`A Connect link points to someone other than ${invitee.full}: ${mismatchedVanity}.`);
        }
        const allVanitiesMatch = ownSlug !== null
          && links.length > 0
          && vanities.every((vanity) => vanity !== null && vanity.toLowerCase() === ownSlug.toLowerCase());
        if (allVanitiesMatch || links.length === 1) {
          const linkName = await deps.controlName(links[0]);
          const verdict = acceptable(linkName, true);
          if (verdict === "stop") return stop(`The Connect control names someone other than ${invitee.full}: ${linkName}.`);
          if (verdict === "ok") {
            connect = links[0];
            connectName = linkName;
          }
        } else if (links.length > 1) {
          return stop(`More than one Connect link was found for ${invitee.full}.`);
        }
      }
    }
    if (!connect || !connectName) return stop(`No Connect control for ${invitee.full} was found.`);
    await press(connect, connectName);

    step = "add-note";
    let addNote = await deps.waitForControl({ scope: "dialog", role: "button", name: ADD_NOTE_NAME, timeoutMs: 10_000 });
    addNote ??= await deps.waitForControl({ scope: "page", role: "button", name: ADD_NOTE_NAME, timeoutMs: 5_000 });
    if (!addNote) return stop("The invitation dialog has no visible Add a note button.");
    await press(addNote);

    step = "name-check";
    store = await getStore();
    item = store.outbox?.find((candidate) => candidate.id === itemId);
    const firstName = item?.name.trim().split(/\s+/)[0] ?? "";
    let dialogText = await deps.dialogText();
    for (let retry = 0; dialogText === null && retry < NAME_CHECK_MAX_RETRIES; retry += 1) {
      await deps.sleep(NAME_CHECK_READ_INTERVAL_MS);
      dialogText = await deps.dialogText();
    }
    const namesInvitee = dialogText !== null
      && firstName !== ""
      && dialogText.toLocaleLowerCase().includes(firstName.toLocaleLowerCase());
    let onOwnProfile = false;
    if (dialogText !== null && !namesInvitee) {
      const ownSlug = item ? linkedInProfileSlug(item.profileUrl) : null;
      const pageSlug = linkedInProfileSlug(await deps.pageUrl());
      onOwnProfile = ownSlug !== null && pageSlug === ownSlug;
    }
    if (dialogText === null || (!namesInvitee && !onOwnProfile)) {
      const detail = dialogText === null
        ? " No single note dialog with a text box was found."
        : ` Dialog text: "${dialogText.slice(0, 200)}"`;
      return stop(`The note dialog does not name ${firstName || "the invitee"}.${detail}`);
    }

    step = "type";
    store = await getStore();
    item = store.outbox?.find((candidate) => candidate.id === itemId);
    if (!item || item.status !== "sending" || sha256Hex(item.text) !== item.approvedTextHash) {
      return stop("The approved text changed or the invite is no longer sending.");
    }
    const textbox = await deps.waitForControl({ scope: "dialog", role: "textbox", timeoutMs: 10_000 });
    if (!textbox) return stop("The invitation dialog has no visible text box.");
    await deps.fill(textbox, item.text);
    rememberTypedText(item.profileUrl, item.text);
    typedUrl = item.profileUrl;

    step = "send";
    let send = await deps.waitForControl({ scope: "dialog", role: "button", name: SEND_INVITATION_NAME, timeoutMs: 10_000 });
    send ??= await deps.waitForControl({ scope: "dialog", role: "button", name: SEND_NAME, timeoutMs: 10_000 });
    if (!send) return stop("The invitation dialog has no visible Send invitation or Send button.");
    await press(send);

    const pageTexts: string[] = [];
    let refusal: string | null = null;
    for (let read = 0; read < 3 && refusal === null; read += 1) {
      if (read > 0) await deps.sleep(1000);
      const text = await deps.pageText();
      pageTexts.push(text);
      refusal = findLinkedInInviteRefusal(text);
    }
    if (refusal) {
      const reason = refusal;
      if (typedUrl !== null) forgetTypedText(typedUrl);
      await updateStore((current) => {
        pauseLinkedInInvites(current.settings, reason, deps.now());
        const refusedItem = current.outbox?.find((candidate) => candidate.id === itemId);
        if (refusedItem) {
          refusedItem.status = "approved";
          delete refusedItem.sendingAt;
          refusedItem.error = `LinkedIn refused this invitation: ${reason}`;
        }
        current.computerLogs.unshift({
          id: nid("log"), at: nowIso(), botId: "outbox", kind: "browser",
          summary: `LinkedIn refused an invitation: ${reason}`,
        });
      });
      return { outcome: "refused", reason };
    }

    step = "confirm";
    let signal: string | null = pageTexts.some((text) => /\bInvitation sent\b/i.test(text)) ? "toast" : null;
    let moreOpen = false;
    if (signal === null) {
      const pending = await deps.waitForControl({ scope: "main", role: "button", name: PENDING_NAME, timeoutMs: 10_000 });
      if (pending) signal = "pending-main";
    }
    if (signal === null) {
      const more = await deps.waitForControl({ scope: "main", role: "button", name: MORE_NAME, timeoutMs: 10_000 });
      if (more) {
        const moreName = await deps.controlName(more);
        if (MORE_NAME.test(moreName.trim())) {
          await press(more, moreName);
          moreOpen = true;
          for (const [role, timeoutMs] of [["button", 10_000], ["link", 3_000]] as const) {
            const pending = await deps.waitForControl({ scope: "menu", role, name: PENDING_NAME, timeoutMs });
            if (pending) {
              signal = "pending-menu";
              break;
            }
          }
        }
      }
    }
    if (signal === null && moreOpen) {
      for (const role of ["menuitem", "link", "button"] as const) {
        const pending = await deps.waitForControl({ scope: "page", role, name: PENDING_NAME, timeoutMs: 3_000 });
        if (pending) {
          signal = "pending-page";
          break;
        }
      }
    }
    if (signal === null) {
      const open = await deps.dialogText();
      return stop(
        "No Pending button appeared; the invitation may have been sent."
          + (open !== null ? " Dialog still open: yes." : " Dialog still open: no.")
          + " Checked: toast, main, menu, page."
      );
    }

    const confirmationSignal = signal;
    let sentItemId = itemId;
    await updateStore((current) => {
      noteLinkedInSendPaced(current.settings, nowIso());
      const entry = recordLinkedInSend(current, {
        botId: "outbox", conversationId: "outbox", messageId: itemId,
        url: item!.profileUrl, action: "click", label: "Send invitation",
      });
      sentItemId = entry.outboxItemId ?? itemId;
      current.computerLogs.unshift({
        id: nid("log"), at: nowIso(), botId: "outbox", kind: "browser",
        summary: `LinkedIn ${entry.kind} recorded: ${entry.slug ?? entry.url} Confirmed by: ${confirmationSignal}. Clicked: ${clicked.join(", ")}`,
      });
    });
    return { outcome: "sent", itemId: sentItemId };
  } catch (error) {
    return stop(error instanceof Error ? error.message : String(error));
  }
}
