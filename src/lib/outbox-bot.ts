import { checkLinkedInPacing, linkedInSendGapSeconds } from "@/lib/agent/linkedin-pacing";
import { linkedInProfileSlug, recordLinkedInSend } from "@/lib/agent/linkedin-send-log";
import {
  checkLinkedInInviteCap,
  checkLinkedInInvitePause,
  checkLinkedInWeeklyInviteCap,
  checkLinkedInSendWindow,
  DEFAULT_LINKEDIN_DAILY_INVITE_CAP,
  DEFAULT_LINKEDIN_WEEKLY_INVITE_CAP,
  DEFAULT_LINKEDIN_SEND_WEEKDAYS_ONLY,
  DEFAULT_LINKEDIN_SEND_WINDOW_END,
  DEFAULT_LINKEDIN_SEND_WINDOW_START,
  nextLinkedInWindowStart,
} from "@/lib/agent/linkedin-budget";
import { handleUserMessage, stopConversation } from "@/lib/agent/run";
import { nid, nowIso } from "@/lib/ids";
import { measureOutboxAftermath } from "@/lib/outbox-aftermath";
import { sendInviteDirect } from "@/lib/outbox-direct";
import { closeLeftoverLinkedInConversations } from "@/lib/outbox-leftovers";
import { getStore, updateStore } from "@/lib/store";
import type { OutboxItem, Store } from "@/lib/types";

interface OutboxRunState {
  active: boolean;
  stopRequested: boolean;
  nextAt: string | null;
  reason: string;
}

declare global {
  var __crewOutboxRun: OutboxRunState | undefined;
}

function runState() {
  return (globalThis.__crewOutboxRun ??= {
    active: false,
    stopRequested: false,
    nextAt: null,
    reason: "",
  });
}

function setRunActive(value: boolean): void {
  runState().active = value;
  try {
    Promise.resolve(updateStore((store) => {
      store.settings.outboxRunActive = value;
    })).catch(() => {});
  } catch {}
}

export type StartNextOutboxItemResult =
  | { started: true; itemId: string }
  | { started: false; reason: string; nextAllowedAt?: Date };

export function outboxStallMinutes(store: Store): number {
  return store.settings.outboxStallMinutes ?? 30;
}

export function outboxRecentMessageDays(store: Store): number {
  return store.settings.outboxRecentMessageDays ?? 30;
}

function scheduleStallCheck(itemId: string, delayMs: number): void {
  const timer = setTimeout(() => {
    void checkStalledItem(itemId).catch(() => {});
  }, Math.max(0, delayMs));
  timer.unref?.();
}

export async function checkStalledItem(itemId?: string): Promise<boolean> {
  const store = await getStore();
  const item = store.outbox?.find(
    (candidate) => candidate.status === "sending" && (!itemId || candidate.id === itemId)
  );
  if (!item?.sendingAt) return false;

  const sendingAt = item.sendingAt;
  const sendingAtMs = new Date(sendingAt).getTime();
  const minutes = outboxStallMinutes(store);
  if (Date.now() - sendingAtMs < minutes * 60_000) return false;
  const slug = linkedInProfileSlug(item.profileUrl);
  if (
    slug !== null && (store.linkedinSendLog ?? []).some(
      (entry) => entry.slug === slug && new Date(entry.at).getTime() > sendingAtMs
    )
  ) return false;

  const bot = store.bots.find((candidate) => !candidate.archived);
  const conversation = bot
    ? store.conversations.find(
        (candidate) => candidate.kind === "dm" && candidate.botIds.length === 1 &&
          candidate.botIds[0] === bot.id
      )
    : undefined;
  if (conversation) stopConversation(conversation.id);

  let setAside = false;
  await updateStore((current) => {
    const currentItem = current.outbox?.find((candidate) => candidate.id === item.id);
    if (currentItem?.status !== "sending" || currentItem.sendingAt !== sendingAt) return;

    const currentSlug = linkedInProfileSlug(currentItem.profileUrl);
    if (
      currentSlug !== null && (current.linkedinSendLog ?? []).some(
        (entry) => entry.slug === currentSlug && new Date(entry.at).getTime() > sendingAtMs
      )
    ) return;

    const summary = `Stalled: set aside after ${minutes} minutes so the queue could continue. Check LinkedIn for ${currentItem.name}, then confirm it sent or approve it again.`;
    currentItem.status = "failed";
    currentItem.error = summary;
    current.computerLogs.unshift({
      id: nid("log"),
      at: nowIso(),
      botId: "outbox",
      kind: "browser",
      summary,
    });
    if (
      currentItem.kind === "invite" &&
      !(current.linkedinSendLog ?? []).some(
        (entry) => entry.outboxItemId === currentItem.id && !entry.voidedAt
      )
    ) {
      const entry = recordLinkedInSend(current, {
        botId: "outbox",
        conversationId: "outbox",
        messageId: currentItem.id,
        url: currentItem.profileUrl,
        action: "click",
        label: null,
        text: null,
        kind: "invite",
        at: nowIso(),
      });
      entry.text = null;
      entry.outboxItemId = currentItem.id;
      entry.stalled = true;
      if (currentItem.lane) entry.lane = currentItem.lane;
    }
    setAside = true;
  });

  if (setAside && runState().active && !runState().stopRequested) {
    onOutboxItemSettled(await getStore(), "sent");
  }
  return setAside;
}

function earliestCreated(items: OutboxItem[]): OutboxItem {
  return items.reduce((earliest, candidate) =>
    new Date(candidate.createdAt).getTime() < new Date(earliest.createdAt).getTime()
      ? candidate
      : earliest
  );
}

async function startBotTurn(item: OutboxItem, conversationId: string, firstLine?: string): Promise<void> {
  const current = await getStore();
  const finalApprovalSentence = current.settings.outboxSendWithoutFinalApproval
    ? "The operator already approved this exact text in the Outbox; type it exactly and complete the send."
    : "The operator approves once, when you type the text.";
  const text = item.kind === "invite" ? `Send the approved LinkedIn connection invitation below using the shared browser.

Open exactly ${item.profileUrl} with browser_navigate. Take a browser_screenshot before every click and click by ref. Click that person's Connect button, which may sit under the profile's More menu. When a dialog offers Add a note, click it, take a screenshot, and confirm the dialog names ${item.name}; if it names anyone else, stop and tell the operator. Type exactly the following approved text, quoted in full:

"${item.text}"

${finalApprovalSentence} After that approval, complete the send. If clicking Connect sent the invitation at once with no dialog, stop and tell the operator so.` : `Send the approved LinkedIn message below using the shared browser.

Open exactly ${item.profileUrl} with browser_navigate. Take a browser_screenshot before every click and click by ref. Open that person's message box from their profile. Take another screenshot and confirm the message box header names ${item.name}; if it names anyone else, stop and tell the operator. Open only that person's conversation from their profile, never open the Messaging list, read the visible message history, then call record_linkedin_thread with profileUrl and with lastFromOperatorAt and lastFromOperatorLine for the date and first line of the most recent message from the operator, or with neither optional field when the operator has never messaged them. Type exactly the following approved text, quoted in full:

"${item.text}"

${finalApprovalSentence} After that approval, complete the send. After sending, confirm the message appears and close that conversation window.`;
  void handleUserMessage({
    conversationId,
    text: firstLine ? `${firstLine}\n\n${text}` : text,
    emit: () => {},
  }).catch(() => {});
}

let directSettled: Promise<void> = Promise.resolve();
export function outboxDirectSettled(): Promise<void> {
  return directSettled;
}

function runDirectInvite(item: OutboxItem, conversationId: string): void {
  directSettled = sendInviteDirect(item.id).then(async (result) => {
    if (result.outcome === "sent") {
      onOutboxItemSettled(await getStore(), "sent");
      void measureOutboxAftermath(result.itemId).catch(() => {});
      return;
    }
    if (result.outcome === "held") return;
    if (result.outcome === "refused") {
      const store = await getStore();
      const until = new Date(store.settings.linkedinInvitesPausedUntil ?? Date.now() + 86_400_000);
      deferOutboxRun(store, until);
      return;
    }
    const warning = result.step === "confirm"
      ? " Check the profile card and its More menu for Pending before clicking anything. If Pending is shown, call record_invite_already_sent with what you saw and stop. Never follow links off the profile."
      : "";
    await startBotTurn(
      item,
      conversationId,
      `Outbox direct send stopped at ${result.step}: ${result.reason}.${warning} Code did not finish this invite; carry on with the steps below.`
    );
  }).catch(async (error) => {
    await startBotTurn(
      item,
      conversationId,
      `Outbox direct send stopped at unexpected: ${error instanceof Error ? error.message : String(error)}. Code did not finish this invite; carry on with the steps below.`
    );
  });
}

async function closeLeftoversForSend(): Promise<void> {
  try {
    const closed = await closeLeftoverLinkedInConversations();
    if (closed.length === 0) return;
    await updateStore((store) => {
      store.computerLogs.unshift({
        id: nid("log"),
        at: nowIso(),
        botId: "outbox",
        kind: "browser",
        summary: `Closed leftover LinkedIn conversations: ${closed.join("; ")}`,
      });
    });
  } catch {
    // Leftover cleanup must never block an Outbox send.
  }
}

export async function startNextOutboxItem(): Promise<StartNextOutboxItemResult> {
  const store = await getStore();
  if (store.outbox?.some((item) => item.status === "sending")) {
    return { started: false, reason: "An item is already sending." };
  }

  const approved = (store.outbox ?? []).filter((item) => item.status === "approved");
  if (approved.length === 0) return { started: false, reason: "No approved items." };
  // A message without a lane is a reply, so send it before outreach.
  const replies = approved.filter((item) => item.kind !== "invite" && !item.lane);
  const pool = replies.length > 0 ? replies : approved;
  let item = earliestCreated(pool);

  const now = new Date();
  const start = store.settings.linkedinSendWindowStart ?? DEFAULT_LINKEDIN_SEND_WINDOW_START;
  const end = store.settings.linkedinSendWindowEnd ?? DEFAULT_LINKEDIN_SEND_WINDOW_END;
  const weekdaysOnly = store.settings.linkedinSendWeekdaysOnly ??
    DEFAULT_LINKEDIN_SEND_WEEKDAYS_ONLY;
  const window = checkLinkedInSendWindow(
    now,
    start,
    end,
    weekdaysOnly
  );
  if (window.status === "refused") {
    return {
      started: false,
      reason: window.message,
      nextAllowedAt: window.nextAllowedAt,
    };
  }

  if (item.kind === "invite") {
    const pause = checkLinkedInInvitePause(store.settings, now);
    let refusal = pause.status === "refused" ? pause : undefined;
    if (!refusal) {
      const cap = checkLinkedInInviteCap(
        now,
        store.linkedinSendLog,
        store.settings.linkedinDailyInviteCap ?? DEFAULT_LINKEDIN_DAILY_INVITE_CAP,
        nextLinkedInWindowStart(now, start, end, weekdaysOnly)
      );
      if (cap.status === "refused") refusal = cap;
    }
    if (!refusal) {
      const weekly = checkLinkedInWeeklyInviteCap(
        now,
        store.linkedinSendLog,
        store.settings.linkedinWeeklyInviteCap ?? DEFAULT_LINKEDIN_WEEKLY_INVITE_CAP
      );
      if (weekly.status === "refused") refusal = weekly;
    }
    if (refusal) {
      const messages = approved.filter((candidate) => candidate.kind !== "invite");
      if (messages.length > 0) {
        item = earliestCreated(messages);
      } else {
        return { started: false, reason: refusal.message, nextAllowedAt: refusal.nextAllowedAt };
      }
    }
  }

  const pacing = checkLinkedInPacing(
    new Date(),
    store.settings.linkedinLastActionAt,
    linkedInSendGapSeconds(store.settings)
  );
  if (pacing.status === "refused") {
    const hours = String(pacing.nextAllowedAt.getHours()).padStart(2, "0");
    const minutes = String(pacing.nextAllowedAt.getMinutes()).padStart(2, "0");
    return {
      started: false,
      reason: `LinkedIn pacing: the next message can be sent at ${hours}:${minutes}.`,
      nextAllowedAt: pacing.nextAllowedAt,
    };
  }

  const bot = store.bots.find((candidate) => !candidate.archived);
  const conversation = bot
    ? store.conversations.find(
        (candidate) =>
          candidate.kind === "dm" &&
          candidate.botIds.length === 1 &&
          candidate.botIds[0] === bot.id
      )
    : undefined;
  if (!bot || !conversation) return { started: false, reason: "No Bot to send with." };

  await updateStore((current) => {
    const currentItem = current.outbox?.find((candidate) => candidate.id === item.id);
    if (!currentItem) throw new Error("Outbox item not found.");
    currentItem.status = "sending";
    currentItem.sendingAt = nowIso();
  });
  scheduleStallCheck(item.id, outboxStallMinutes(store) * 60_000);
  if (item.kind === "invite" && store.settings.outboxDirectInvites) {
    runDirectInvite(item, conversation.id);
    return { started: true, itemId: item.id };
  }
  if (item.kind !== "invite") await closeLeftoversForSend();
  await startBotTurn(item, conversation.id);
  return { started: true, itemId: item.id };
}

function applyStartResult(result: StartNextOutboxItemResult) {
  const state = runState();
  if (!result.started && result.nextAllowedAt) {
    scheduleOutboxRetry(result.nextAllowedAt);
    state.reason = result.reason;
    return;
  }
  if (!result.started && result.reason !== "An item is already sending.") {
    setRunActive(false);
    state.reason = result.reason;
  }
}

function scheduleOutboxRetry(nextAllowedAt: Date): void {
  runState().nextAt = nextAllowedAt.toISOString();
  setTimeout(() => {
    if (runState().stopRequested) {
      setRunActive(false);
      runState().nextAt = null;
      return;
    }
    void startNextOutboxItem().then((result) => {
      runState().nextAt = null;
      applyStartResult(result);
    });
  }, Math.max(0, nextAllowedAt.getTime() - Date.now()) + 1000);
}

export async function startOutboxRun(): Promise<StartNextOutboxItemResult> {
  const state = runState();
  setRunActive(true);
  state.stopRequested = false;
  state.nextAt = null;
  state.reason = "";
  const result = await startNextOutboxItem();
  applyStartResult(result);
  return result;
}

export function onOutboxItemSettled(store: Store, status: "sent" | "failed" | "skipped"): void {
  const state = runState();
  state.nextAt = null;
  if (status === "failed") {
    setRunActive(false);
    state.reason = "Stopped after a failure.";
    const approvedCount = (store.outbox ?? []).filter((item) => item.status === "approved").length;
    if (approvedCount > 0) {
      store.computerLogs.unshift({
        id: nid("log"),
        at: nowIso(),
        botId: "outbox",
        kind: "browser",
        summary: `Outbox run stopped after a failure with ${approvedCount} approved ${approvedCount === 1 ? "item" : "items"} not sent.`,
      });
    }
    return;
  }
  if (!state.active || state.stopRequested) {
    setRunActive(false);
    return;
  }
  if (!(store.outbox ?? []).some((item) => item.status === "approved")) {
    setRunActive(false);
    state.reason = "Done.";
    return;
  }

  const pacing = checkLinkedInPacing(
    new Date(),
    store.settings.linkedinLastActionAt,
    linkedInSendGapSeconds(store.settings)
  );
  const nextAllowedAt = pacing.status === "refused" ? pacing.nextAllowedAt : new Date();
  scheduleOutboxRetry(nextAllowedAt);
}

export function deferOutboxRun(store: Store, nextAllowedAt: Date): void {
  const state = runState();
  if (!state.active || state.stopRequested) return;
  scheduleOutboxRetry(nextAllowedAt);
}

export function stopOutboxRun(): void {
  runState().stopRequested = true;
}

export async function resumeOutboxRunOnBoot(): Promise<void> {
  let store = await getStore();
  let outbox = store.outbox ?? [];
  const sending = outbox.find((item) => item.status === "sending");
  if (sending) {
    const setAside = await checkStalledItem(sending.id);
    if (!setAside && sending.sendingAt) {
      const remaining = outboxStallMinutes(store) * 60_000 -
        (Date.now() - new Date(sending.sendingAt).getTime());
      if (remaining > 0) scheduleStallCheck(sending.id, remaining);
    }
    store = await getStore();
    outbox = store.outbox ?? [];
  }
  if (
    !store.settings.outboxRunActive ||
    store.settings.linkedinHold ||
    !outbox.some((item) => item.status === "approved") ||
    outbox.some((item) => item.status === "sending")
  ) return;
  await startOutboxRun();
}

export function getOutboxRun(): OutboxRunState {
  return { ...runState() };
}
