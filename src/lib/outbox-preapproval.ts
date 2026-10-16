import { linkedInProfileSlug, typedTextFor } from "@/lib/agent/linkedin-send-log";
import { sha256Hex } from "@/lib/outbox";
import type { Store } from "@/lib/types";

type PreapprovalAction =
  | { tool: "browser_type"; url: string; text: string }
  | {
      tool: "browser_click";
      url: string;
      label: string | null;
      hasRef: boolean;
      composeText?: string | null;
    };

function collapse(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function quotedLabelText(label: string | null) {
  return label?.match(/["“]([^"”]*)["”]/)?.[1] ?? null;
}

export function isOutboxPreapproved(store: Store, action: PreapprovalAction): boolean {
  const sending = (store.outbox ?? []).filter((item) => item.status === "sending");
  if (sending.length !== 1) return false;
  const item = sending[0];
  if (item.approvedTextHash !== sha256Hex(item.text)) return false;

  const actionSlug = linkedInProfileSlug(action.url);
  if (!actionSlug || actionSlug !== linkedInProfileSlug(item.profileUrl)) return false;

  if (action.tool === "browser_type") {
    return false;
  }

  if (!action.hasRef) return false;
  const label = quotedLabelText(action.label)?.trim().toLowerCase();
  if (!label) return false;
  if (label === "message" || label === "add a note") return true;
  if (item.kind === "invite" && (label === "connect" || label.includes("connect"))) {
    return true;
  }
  if (item.kind === "invite") {
    return (
      label === "send invitation" &&
      collapse(typedTextFor(action.url)) === collapse(item.text)
    );
  }
  if (
    !["send", "send invitation", "send without a note"].includes(label) ||
    collapse(typedTextFor(action.url)) !== collapse(item.text)
  ) {
    return false;
  }
  const composeText =
    typeof action.composeText === "string" ? collapse(action.composeText).toLowerCase() : null;
  const composeName = collapse(item.name).toLowerCase();
  return composeText != null && composeText.includes(composeName);
}

export function isOutboxSendText(
  store: Store,
  url: string | undefined,
  text: string
): boolean {
  const sending = (store.outbox ?? []).filter((item) => item.status === "sending");
  if (sending.length !== 1) return false;
  const item = sending[0];
  if (item.approvedTextHash !== sha256Hex(item.text)) return false;

  const actionSlug = url ? linkedInProfileSlug(url) : null;
  if (!actionSlug || actionSlug !== linkedInProfileSlug(item.profileUrl)) return false;
  return collapse(text) === collapse(item.text);
}
