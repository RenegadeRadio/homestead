import type { Settings } from "@/lib/types";

export const DEFAULT_LINKEDIN_GAP_SECONDS = 2700;

type LinkedInGapSettings = Pick<
  Settings,
  "linkedinGapSeconds" | "linkedinGapMaxSeconds" | "linkedinSendGapSeconds"
>;

export function drawLinkedInSendGapSeconds(
  settings: LinkedInGapSettings,
  random = Math.random
): number | undefined {
  const minimum = settings.linkedinGapSeconds ?? DEFAULT_LINKEDIN_GAP_SECONDS;
  const maximum = settings.linkedinGapMaxSeconds;
  if (typeof maximum !== "number" || !Number.isFinite(maximum) || maximum <= minimum) {
    return undefined;
  }

  const first = Math.ceil(minimum);
  const end = Math.ceil(maximum);
  if (end <= first) return undefined;
  return first + Math.floor(random() * (end - first));
}

export function noteLinkedInSendPaced(settings: Settings, at: string): void {
  if (
    !settings.linkedinLastActionAt ||
    new Date(settings.linkedinLastActionAt).getTime() < new Date(at).getTime()
  ) {
    settings.linkedinLastActionAt = at;
    const gap = drawLinkedInSendGapSeconds(settings);
    if (gap === undefined) delete settings.linkedinSendGapSeconds;
    else settings.linkedinSendGapSeconds = gap;
  }
}

export function linkedInSendGapSeconds(settings: LinkedInGapSettings): number {
  const minimum = settings.linkedinGapSeconds ?? DEFAULT_LINKEDIN_GAP_SECONDS;
  const drawn = settings.linkedinSendGapSeconds;
  return typeof drawn === "number" && Number.isFinite(drawn) && drawn > minimum
    ? drawn
    : minimum;
}

export type LinkedInAction =
  | { kind: "click"; label?: string | null }
  | { kind: "type"; text: string }
  | { kind: "press"; key: string };

export function quotedLabelText(label: string | null | undefined) {
  return label?.match(/["“]([^"”]*)["”]/)?.[1] ?? null;
}

export function isLinkedInSendAction(action: LinkedInAction) {
  if (action.kind === "type") return /[\n\r]/.test(action.text);
  if (action.kind === "press") {
    const key = action.key.split("+").at(-1)?.toLowerCase();
    return key === "enter" || key === "numpadenter";
  }

  const text = quotedLabelText(action.label)?.trim().toLowerCase();
  if (!text) return false;
  if (text === "send") return true;
  if (text.startsWith("send") && !text.startsWith("send a message")) return true;
  return false;
}

export function isLinkedInUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "linkedin.com" || hostname.endsWith(".linkedin.com") ||
      hostname === "lnkd.in" || hostname.endsWith(".lnkd.in");
  } catch {
    return false;
  }
}

export function isLinkedInSearchUrl(url: string) {
  if (!isLinkedInUrl(url)) return false;
  try {
    const pathname = new URL(url).pathname;
    return pathname.startsWith("/search/") || pathname.startsWith("/sales/search");
  } catch {
    return false;
  }
}

export type LinkedInPacingDecision =
  | { status: "allowed" }
  | { status: "refused"; nextAllowedAt: Date; message: string };

export function checkLinkedInPacing(
  now: Date,
  lastActionAt: string | undefined,
  gapSeconds: number
): LinkedInPacingDecision {
  if (!lastActionAt) return { status: "allowed" };

  const nextAllowedAt = new Date(new Date(lastActionAt).getTime() + gapSeconds * 1000);
  if (now.getTime() >= nextAllowedAt.getTime()) return { status: "allowed" };

  const hours = String(nextAllowedAt.getHours()).padStart(2, "0");
  const minutes = String(nextAllowedAt.getMinutes()).padStart(2, "0");
  return {
    status: "refused",
    nextAllowedAt,
    message: `LinkedIn pacing: the next LinkedIn message or invite is allowed at ${hours}:${minutes}. End your turn now and try again after that.`,
  };
}
