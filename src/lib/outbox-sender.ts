import {
  browserClick,
  browserComposeText,
  browserElements,
  browserNavigate,
  browserPageText,
  browserType,
  setBrowserMode,
} from "@/lib/browser";
import {
  checkLinkedInPacing,
  linkedInSendGapSeconds,
  noteLinkedInSendPaced,
} from "@/lib/agent/linkedin-pacing";
import {
  ensureInviteProspect,
  recordLinkedInSend,
} from "@/lib/agent/linkedin-send-log";
import { syncPendingSends } from "@/lib/crm/notion-sync";
import { nid } from "@/lib/ids";
import { sha256Hex } from "@/lib/outbox";
import { getStore, updateStore } from "@/lib/store";
import type { OutboxItem, Store } from "@/lib/types";

type OutboxElement = { ref: number; tag: string; role: string; text: string };

export interface SendOutboxDeps {
  navigate: (url: string) => Promise<{ gate: { needed: boolean; reason: string } }>;
  snapshotElements: () => Promise<OutboxElement[]>;
  click: (ref: number) => Promise<void>;
  type: (ref: number, text: string) => Promise<void>;
  composeText: () => Promise<string | null>;
  pageText: () => Promise<string>;
  setMode: (mode: "bot" | "human", reason: string) => Promise<void>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps: SendOutboxDeps = {
  navigate: async (url) => {
    const result = await browserNavigate(url);
    return "blocked" in result && result.blocked
      ? { gate: { needed: true, reason: result.result } }
      : { gate: result.gate };
  },
  snapshotElements: browserElements,
  click: async (ref) => { await browserClick({ ref }); },
  type: async (ref, text) => { await browserType(text, ref); },
  composeText: browserComposeText,
  pageText: browserPageText,
  setMode: async (mode, reason) => { await setBrowserMode(mode, reason); },
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function fail(item: OutboxItem, error: string) {
  item.status = "failed";
  item.error = error;
}

function button(elements: OutboxElement[], text: string) {
  return elements
    .filter(
      (element) =>
        element.text.trim() === text &&
        (element.tag === "button" ||
          element.role === "button" ||
          element.tag === "a" ||
          element.role === "link")
    )
    .reduce<OutboxElement | undefined>(
      (lowest, element) => (!lowest || element.ref < lowest.ref ? element : lowest),
      undefined
    );
}

export async function sendOutboxItem(store: Store, item: OutboxItem, deps: SendOutboxDeps) {
  if (item.status !== "approved" || sha256Hex(item.text) !== item.approvedTextHash) {
    item.status = "draft";
    return;
  }

  try {
    const navigation = await deps.navigate(item.profileUrl);
    if (navigation.gate.needed) {
      await deps.setMode("human", navigation.gate.reason);
      fail(item, `Needs you: ${navigation.gate.reason}`);
      return;
    }

    let elements = await deps.snapshotElements();
    const message = button(elements, "Message");
    if (!message) {
      fail(item, "No Message button on the profile.");
      return;
    }
    await deps.click(message.ref);

    elements = await deps.snapshotElements();
    const textbox = elements.find(
      (element) => element.role === "textbox" || element.tag === "textarea"
    );
    if (!textbox) {
      fail(item, "No message box opened.");
      return;
    }
    const composeText = await deps.composeText();
    if (composeText === null) {
      fail(item, "No single compose dialog found. Nothing was typed.");
      return;
    }
    const name = item.name.replace(/\s+/g, " ").trim();
    if (!composeText.includes(name)) {
      fail(item, `Compose box does not name ${item.name}. Nothing was typed.`);
      return;
    }
    await deps.type(textbox.ref, item.text);

    elements = await deps.snapshotElements();
    const send = button(elements, "Send");
    if (!send) {
      fail(item, "No Send button.");
      return;
    }
    await deps.click(send.ref);

    const confirmText = ((await deps.composeText()) ?? "").replace(/\s+/g, " ").trim();
    const prefix = item.text.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!confirmText.includes(prefix)) {
      fail(item, "Send not confirmed. Check LinkedIn before retrying.");
      return;
    }

    item.status = "sent";
    item.sentAt = deps.now().toISOString();
    if (item.kind === "invite") ensureInviteProspect(store, item);
    delete item.error;
    noteLinkedInSendPaced(store.settings, item.sentAt);
    recordLinkedInSend(store, {
      botId: "outbox",
      conversationId: "outbox",
      messageId: item.id,
      url: item.profileUrl,
      action: "type",
      text: item.text,
    });
    store.computerLogs.push({
      id: nid("log"),
      at: item.sentAt,
      botId: "outbox",
      kind: "browser",
      summary: `Outbox sent: ${item.name}`,
    });
  } catch (error) {
    fail(item, error instanceof Error ? error.message : String(error));
  }
}

declare global {
  var __crewOutboxRunning: boolean | undefined;
}

export function isOutboxRunning() {
  return !!globalThis.__crewOutboxRunning;
}

export async function runOutbox(deps: SendOutboxDeps = defaultDeps): Promise<{ started: boolean }> {
  if (globalThis.__crewOutboxRunning) return { started: false };
  globalThis.__crewOutboxRunning = true;
  try {
    const ids = ((await getStore()).outbox ?? [])
      .filter((item) => item.status === "approved")
      .map((item) => item.id);
    for (const id of ids) {
      const current = await getStore();
      const pacing = checkLinkedInPacing(
        deps.now(),
        current.settings.linkedinLastActionAt,
        linkedInSendGapSeconds(current.settings)
      );
      if (pacing.status === "refused") {
        await deps.sleep(Math.max(0, pacing.nextAllowedAt.getTime() - deps.now().getTime()));
      }

      const finalStatus = await updateStore(async (store) => {
        const item = store.outbox?.find((candidate) => candidate.id === id);
        if (!item) return;
        await sendOutboxItem(store, item, deps);
        return item.status;
      });
      if (finalStatus === "sent") {
        try {
          await syncPendingSends({ fetchFn: fetch, env: process.env });
        } catch {
          // CRM availability must not affect the outbox run.
        }
      } else if (finalStatus === "failed") {
        break;
      }
    }
    return { started: true };
  } finally {
    globalThis.__crewOutboxRunning = false;
  }
}
