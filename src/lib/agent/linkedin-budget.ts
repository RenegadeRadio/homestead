import { isLinkedInUrl, type LinkedInPacingDecision } from "@/lib/agent/linkedin-pacing";
import type { LinkedInSendEntry, Settings } from "@/lib/types";

export const DEFAULT_LINKEDIN_ACTION_GAP_MIN_SECONDS = 45;
export const DEFAULT_LINKEDIN_ACTION_GAP_MAX_SECONDS = 150;
export const DEFAULT_LINKEDIN_SEND_WINDOW_START = "09:00";
export const DEFAULT_LINKEDIN_SEND_WINDOW_END = "18:00";
export const DEFAULT_LINKEDIN_SEND_WEEKDAYS_ONLY = true;
export const DEFAULT_LINKEDIN_DAILY_INVITE_CAP = 10;
export const DEFAULT_LINKEDIN_WEEKLY_INVITE_CAP = 35;
export const DEFAULT_LINKEDIN_DAILY_PAGE_LOADS = 40;
export const AUTOWALL_PATHS = ["/authwall", "/login", "/uas/login", "/checkpoint", "/signup"];

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

export function formatSastTime(date: Date): string {
  const sast = new Date(date.getTime() + SAST_OFFSET_MS);
  return `${String(sast.getUTCHours()).padStart(2, "0")}:${String(
    sast.getUTCMinutes()
  ).padStart(2, "0")} on ${sast.getUTCFullYear()}-${String(
    sast.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(sast.getUTCDate()).padStart(2, "0")}`;
}

export function findLinkedInInviteRefusal(text: string | null): string | null {
  if (!text) return null;
  const phrase = /reached the weekly limit for connection invitations/i;
  const match = phrase.exec(text);
  if (!match) return null;
  const before = text.slice(0, match.index);
  const startBoundary = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("\n"));
  const after = text.slice(match.index + match[0].length);
  const endMatch = /[.!?]|\n/.exec(after);
  const end = endMatch ? match.index + match[0].length + endMatch.index + (endMatch[0] === "\n" ? 0 : 1) : text.length;
  return text.slice(startBoundary + 1, end).replace(/\s+/g, " ").trim().slice(0, 300) || null;
}

export function pauseLinkedInInvites(settings: Settings, reason: string, now: Date): Date {
  const until = new Date(now.getTime() + DAY_MS);
  settings.linkedinInvitesPausedUntil = until.toISOString();
  settings.linkedinInvitePauseReason = reason;
  return until;
}

export function checkLinkedInInvitePause(settings: Settings, now: Date): LinkedInPacingDecision {
  const until = new Date(settings.linkedinInvitesPausedUntil ?? "");
  if (!Number.isFinite(until.getTime()) || until.getTime() <= now.getTime()) return { status: "allowed" };
  return {
    status: "refused",
    nextAllowedAt: until,
    message: `LinkedIn invites are paused until ${formatSastTime(until)}: ${settings.linkedinInvitePauseReason ?? ""} End your turn now.`,
  };
}

export const linkedInBudgetIO = {
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

export async function waitForLinkedInActionGap(
  settings: Settings,
  now: () => Date = () => new Date(),
  onWait?: (ms: number) => void,
  sleep: (ms: number) => Promise<void> = linkedInBudgetIO.sleep
): Promise<number> {
  if (!settings.linkedinNextActionAt) return 0;
  const waitMs = new Date(settings.linkedinNextActionAt).getTime() - now().getTime();
  if (!Number.isFinite(waitMs) || waitMs <= 0) return 0;
  onWait?.(waitMs);
  await sleep(waitMs);
  return waitMs;
}

export function scheduleNextLinkedInAction(
  settings: Settings,
  completedAt: Date,
  random: () => number = Math.random
): void {
  let min = settings.linkedinActionGapMinSeconds ?? DEFAULT_LINKEDIN_ACTION_GAP_MIN_SECONDS;
  let max = settings.linkedinActionGapMaxSeconds ?? DEFAULT_LINKEDIN_ACTION_GAP_MAX_SECONDS;
  if (min === 0 && max === 0) {
    delete settings.linkedinNextActionAt;
    return;
  }
  min = Math.max(0, min);
  max = Math.max(0, max);
  if (max < min) [min, max] = [max, min];
  const seconds = min + random() * (max - min);
  settings.linkedinNextActionAt = new Date(
    completedAt.getTime() + Math.round(seconds * 1000)
  ).toISOString();
}

export function parseHHMM(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : Number.NaN;
}

export function sastMinutesOfDay(date: Date): number {
  const shifted = new Date(date.getTime() + SAST_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function sastDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + SAST_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${shifted.getUTCMonth() + 1}-${shifted.getUTCDate()}`;
}

export function nextLinkedInWindowStart(
  now: Date,
  startStr: string,
  endStr: string,
  weekdaysOnly: boolean
): Date {
  if (startStr === endStr) {
    const sastNow = new Date(now.getTime() + SAST_OFFSET_MS);
    return new Date(Date.UTC(
      sastNow.getUTCFullYear(),
      sastNow.getUTCMonth(),
      sastNow.getUTCDate() + 1,
      -2
    ));
  }
  const start = parseHHMM(startStr);
  if (!Number.isFinite(start)) return new Date(now.getTime() + DAY_MS);
  const sastNow = new Date(now.getTime() + SAST_OFFSET_MS);
  let candidate = new Date(Date.UTC(
    sastNow.getUTCFullYear(),
    sastNow.getUTCMonth(),
    sastNow.getUTCDate(),
    Math.floor(start / 60) - 2,
    start % 60
  ));
  if (candidate.getTime() <= now.getTime()) {
    candidate = new Date(candidate.getTime() + DAY_MS);
  }
  while (weekdaysOnly) {
    const day = new Date(candidate.getTime() + SAST_OFFSET_MS).getUTCDay();
    if (day !== 0 && day !== 6) break;
    candidate = new Date(candidate.getTime() + DAY_MS);
  }
  return candidate;
}

export function checkLinkedInSendWindow(
  now: Date,
  startStr: string,
  endStr: string,
  weekdaysOnly = DEFAULT_LINKEDIN_SEND_WEEKDAYS_ONLY
): LinkedInPacingDecision {
  if (startStr === endStr) return { status: "allowed" };
  const start = parseHHMM(startStr);
  const end = parseHHMM(endStr);
  const badValue = !Number.isFinite(start) ? startStr : !Number.isFinite(end) ? endStr : null;
  if (badValue != null) {
    return {
      status: "refused",
      nextAllowedAt: new Date(now.getTime() + DAY_MS),
      message: `LinkedIn send window: "${badValue}" is not a valid time; use the form HH:MM, for example 09:00.`,
    };
  }
  const current = sastMinutesOfDay(now);
  const inWindow = start < end
    ? current >= start && current < end
    : current >= start || current < end;
  const sastNow = new Date(now.getTime() + SAST_OFFSET_MS);
  const day = sastNow.getUTCDay();
  if (inWindow && !(weekdaysOnly && (day === 0 || day === 6))) return { status: "allowed" };

  return {
    status: "refused",
    nextAllowedAt: nextLinkedInWindowStart(now, startStr, endStr, weekdaysOnly),
    message: `LinkedIn pacing: the next LinkedIn message or invite is allowed at ${startStr} SAST. End your turn now and try again after that.`,
  };
}

function isCountedInviteSend(entry: { kind: string; label: string | null; voidedAt?: string }): boolean {
  if (entry.voidedAt) return false;
  if (entry.kind !== "invite") return false;
  const label = entry.label?.match(/["“]([^"”]*)["”]/)?.[1]?.trim().toLowerCase();
  return label == null || ["send", "send invitation", "send without a note"].includes(label);
}

export function countLinkedInInvitesToday(
  now: Date,
  sendLog: LinkedInSendEntry[] | undefined
): number {
  const today = sastDateKey(now);
  return (sendLog ?? []).filter((entry) =>
    isCountedInviteSend(entry) && sastDateKey(new Date(entry.at)) === today
  ).length;
}

function linkedInInvitesLast7Days(
  now: Date,
  sendLog: LinkedInSendEntry[] | undefined
): LinkedInSendEntry[] {
  const nowMs = now.getTime();
  return (sendLog ?? []).filter((entry) => {
    const at = new Date(entry.at).getTime();
    return isCountedInviteSend(entry) && Number.isFinite(at) && at > nowMs - WEEK_MS && at <= nowMs;
  });
}

export function countLinkedInInvitesLast7Days(
  now: Date,
  sendLog: LinkedInSendEntry[] | undefined
): number {
  return linkedInInvitesLast7Days(now, sendLog).length;
}

export function checkLinkedInWeeklyInviteCap(
  now: Date,
  sendLog: LinkedInSendEntry[] | undefined,
  cap: number
): LinkedInPacingDecision {
  if (cap <= 0) return { status: "allowed" };
  const entries = linkedInInvitesLast7Days(now, sendLog);
  if (entries.length < cap) return { status: "allowed" };
  const times = entries
    .map((entry) => new Date(entry.at).getTime())
    .sort((a, b) => a - b);
  const nextAllowedAt = new Date(times[entries.length - cap] + WEEK_MS);
  const time = formatSastTime(nextAllowedAt);
  return {
    status: "refused",
    nextAllowedAt,
    message: `LinkedIn weekly invite cap: ${entries.length} invites in the last 7 days; the cap is ${cap}. The next invite is allowed at ${time}. End your turn now.`,
  };
}

export function checkLinkedInInviteCap(
  now: Date,
  sendLog: LinkedInSendEntry[] | undefined,
  cap: number,
  nextAllowedAt: Date
): LinkedInPacingDecision {
  if (cap <= 0) return { status: "allowed" };
  const count = countLinkedInInvitesToday(now, sendLog);
  if (count < cap) return { status: "allowed" };
  return {
    status: "refused",
    nextAllowedAt,
    message: `LinkedIn invite cap: ${count} invites sent today; the daily cap is ${cap}. End your turn now and try again after that.`,
  };
}

export function pruneLinkedInPageLoads(
  loads: string[] | undefined,
  now: Date
): string[] {
  return (loads ?? []).filter((timestamp) => {
    const age = now.getTime() - new Date(timestamp).getTime();
    return Number.isFinite(age) && age >= 0 && age < DAY_MS;
  });
}

export function checkLinkedInPageBudget(
  now: Date,
  loads: string[] | undefined,
  dailyLimit: number
): LinkedInPacingDecision {
  const pruned = pruneLinkedInPageLoads(loads, now);
  if (dailyLimit > 0 && pruned.length < dailyLimit) return { status: "allowed" };
  if (dailyLimit <= 0 && pruned.length === 0) {
    return {
      status: "refused",
      nextAllowedAt: new Date(now.getTime() + DAY_MS),
      message: "LinkedIn page budget: 0 pages are allowed in the last 24 hours. End your turn now.",
    };
  }
  const nextAllowedAt = dailyLimit > 0
    ? new Date(
        pruned
          .map((timestamp) => new Date(timestamp).getTime())
          .sort((a, b) => a - b)[pruned.length - dailyLimit] + DAY_MS
      )
    : new Date(new Date(pruned[0]).getTime() + DAY_MS);
  const localTime = `${String(nextAllowedAt.getHours()).padStart(2, "0")}:${String(
    nextAllowedAt.getMinutes()
  ).padStart(2, "0")}`;
  return {
    status: "refused",
    nextAllowedAt,
    message: `LinkedIn page budget: ${dailyLimit} pages read in the last 24 hours; the next page load is allowed at ${localTime}. End your turn now.`,
  };
}

export function recordLinkedInPageLoad(settings: Settings, now: Date): void {
  settings.linkedinPageLoads = [
    ...pruneLinkedInPageLoads(settings.linkedinPageLoads, now),
    now.toISOString(),
  ];
}

export type LinkedInHoldDecision =
  | { status: "allowed" }
  | { status: "refused"; message: string };

export function checkLinkedInHold(settings: Settings): LinkedInHoldDecision {
  if (!settings.linkedinHold) return { status: "allowed" };
  return {
    status: "refused",
    message: `LinkedIn hold: ${settings.linkedinHold}. Stop all LinkedIn work and tell the operator. Only the operator can clear this.`,
  };
}

export function automaticLinkedInHoldReason(url: string, gateNeeded: boolean): string | null {
  if (!isLinkedInUrl(url)) return null;
  let pathname = "";
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  if (!gateNeeded && !AUTOWALL_PATHS.some((path) => pathname.startsWith(path))) return null;
  return `automatic: LinkedIn showed ${url}`;
}

export function linkedInPathChanged(before: string, after: string): boolean {
  try {
    return new URL(before).pathname !== new URL(after).pathname;
  } catch {
    return before !== after;
  }
}
