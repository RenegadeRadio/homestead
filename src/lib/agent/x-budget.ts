import { pruneLinkedInPageLoads } from "@/lib/agent/linkedin-budget";
import type { LinkedInPacingDecision } from "@/lib/agent/linkedin-pacing";
import type { Settings } from "@/lib/types";

export const DEFAULT_X_DAILY_PAGE_LOADS = 30;
export const DEFAULT_X_ACTION_GAP_MIN_SECONDS = 30;
export const DEFAULT_X_ACTION_GAP_MAX_SECONDS = 90;
export const DEFAULT_X_REPLY_EXPIRY_HOURS = 18;
export const X_NO_POST_MESSAGE =
  "Nothing is posted to X by a Bot. Record a draft with record_x_reply instead; the operator posts by hand.";

export function isXUrl(raw: string): boolean {
  try {
    const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const hostname = new URL(normalized).hostname.toLowerCase();
    return hostname === "x.com" || hostname.endsWith(".x.com") ||
      hostname === "twitter.com" || hostname.endsWith(".twitter.com");
  } catch {
    return false;
  }
}

export const pruneXPageLoads = pruneLinkedInPageLoads;

export const xBudgetIO = {
  sleep: (ms: number) => new Promise<void>((resolve) =>
    setTimeout(resolve, process.env.VITEST ? 0 : ms)
  ),
};

export async function waitForXActionGap(
  settings: Settings,
  now: () => Date = () => new Date(),
  onWait?: (ms: number) => void,
  sleep: (ms: number) => Promise<void> = (ms) => xBudgetIO.sleep(ms)
): Promise<number> {
  if (!settings.xNextActionAt) return 0;
  const waitMs = new Date(settings.xNextActionAt).getTime() - now().getTime();
  if (!Number.isFinite(waitMs) || waitMs <= 0) return 0;
  onWait?.(waitMs);
  await sleep(waitMs);
  return waitMs;
}

export function scheduleNextXAction(
  settings: Settings,
  completedAt: Date,
  random: () => number = Math.random
): void {
  let min = settings.xActionGapMinSeconds ?? DEFAULT_X_ACTION_GAP_MIN_SECONDS;
  let max = settings.xActionGapMaxSeconds ?? DEFAULT_X_ACTION_GAP_MAX_SECONDS;
  if (min === 0 && max === 0) {
    delete settings.xNextActionAt;
    return;
  }
  min = Math.max(0, min);
  max = Math.max(0, max);
  if (max < min) [min, max] = [max, min];
  const seconds = min + random() * (max - min);
  settings.xNextActionAt = new Date(
    completedAt.getTime() + Math.round(seconds * 1000)
  ).toISOString();
}

export function checkXHold(settings: Settings):
  | { status: "allowed" }
  | { status: "refused"; message: string } {
  if (!settings.xHold) return { status: "allowed" };
  return {
    status: "refused",
    message: `X hold: ${settings.xHold}. Stop all X work and tell the operator. Only the operator can clear this.`,
  };
}

export function automaticXHoldReason(raw: string): string | null {
  if (!isXUrl(raw)) return null;
  try {
    const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const path = new URL(normalized).pathname.toLowerCase();
    const holdPaths = [
      "/i/flow/login",
      "/login",
      "/i/flow/signup",
      "/account/access",
      "/account/suspended",
    ];
    return holdPaths.some((prefix) => path.startsWith(prefix))
      ? `automatic: X showed ${raw}`
      : null;
  } catch {
    return null;
  }
}

export function checkXPageBudget(
  now: Date,
  loads: string[] | undefined,
  dailyLimit: number
): LinkedInPacingDecision {
  const pruned = pruneXPageLoads(loads, now);
  if (dailyLimit > 0 && pruned.length < dailyLimit) return { status: "allowed" };
  if (dailyLimit <= 0 && pruned.length === 0) {
    return {
      status: "refused",
      nextAllowedAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      message: "X page budget: 0 pages are allowed in the last 24 hours. End your turn now.",
    };
  }
  const nextAllowedAt = new Date(new Date(pruned[0]).getTime() + 24 * 60 * 60 * 1000);
  const localTime = `${String(nextAllowedAt.getHours()).padStart(2, "0")}:${String(nextAllowedAt.getMinutes()).padStart(2, "0")}`;
  return {
    status: "refused",
    nextAllowedAt,
    message: `X page budget: ${dailyLimit} pages loaded in the last 24 hours; the next page load is allowed at ${localTime}. End your turn now.`,
  };
}

export function recordXPageLoad(settings: Settings, now: Date): void {
  settings.xPageLoads = [...pruneXPageLoads(settings.xPageLoads, now), now.toISOString()];
}

export function xBrowserRefusal(
  tool: "browser_click" | "browser_type" | "browser_press",
  url: string,
  label?: string
): string | null {
  if (!isXUrl(url)) return null;
  if (tool === "browser_type" || tool === "browser_press") return X_NO_POST_MESSAGE;
  if (label === undefined) return X_NO_POST_MESSAGE;
  const name = label.match(/["“]([^"”]+)["”]/)?.[1]?.trim() ?? label.trim();
  return /\b(?:posts?|repl(?:y|ies)|reposts?|likes?|follow(?:s|ing)?)\b/i.test(name) ? X_NO_POST_MESSAGE : null;
}
