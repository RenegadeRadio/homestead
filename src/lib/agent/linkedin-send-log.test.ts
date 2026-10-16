import { afterEach, describe, expect, it, vi } from "vitest";

import {
  linkedInProfileSlug,
  recordLinkedInSend,
  rememberTypedText,
} from "@/lib/agent/linkedin-send-log";
import { formatSnapshot, type SnapshotEl } from "@/lib/browser";
import { createSeedStore } from "@/lib/seed";

const facts = {
  botId: "bot_test",
  conversationId: "conv_test",
  messageId: "msg_test",
};

function snapshotLabel(url: string, title: string, el: SnapshotEl) {
  return formatSnapshot(url, title, [el])
    .split("\n")
    .find((line) => line.startsWith(`[${el.ref}]`))!;
}

describe("LinkedIn send log", () => {
  afterEach(() => vi.useRealTimers());

  it("extracts only LinkedIn profile slugs", () => {
    expect(
      linkedInProfileSlug("https://za.linkedin.com/in/Alan-Turing-59a2ba65/?trk=x")
    ).toBe("alan-turing-59a2ba65");
    expect(linkedInProfileSlug("https://www.linkedin.com/messaging/thread/abc/")).toBeNull();
    expect(linkedInProfileSlug("https://linkedin.com.evil.example/in/x")).toBeNull();
  });

  it("creates the list and joins then clears remembered text", () => {
    const store = createSeedStore();
    const url = "https://www.linkedin.com/in/jane-doe-123/";
    expect(store.linkedinSendLog).toBeUndefined();
    rememberTypedText(`${url}?one=1`, "Hi Jane, ");
    rememberTypedText(`${url}#composer`, "thanks for connecting.");

    const first = recordLinkedInSend(store, {
      ...facts,
      url,
      action: "click",
      label: "Send",
    });
    const second = recordLinkedInSend(store, {
      ...facts,
      url,
      action: "click",
      label: "Send",
    });

    expect(first.text).toBe("Hi Jane, thanks for connecting.");
    expect(first.kind).toBe("message");
    expect(second.text).toBeNull();
    expect(store.linkedinSendLog).toHaveLength(2);
  });

  it("classifies a recent profile invitation confirmation as an invite", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-16T10:00:00.000Z");
    const store = createSeedStore();
    const url = "https://www.linkedin.com/in/jane-doe-123/";
    const connect = recordLinkedInSend(store, {
      ...facts,
      url,
      action: "click",
      label: "Connect",
    });
    vi.setSystemTime("2026-09-16T10:15:00.000Z");
    const send = recordLinkedInSend(store, {
      ...facts,
      url,
      action: "click",
      label: "Send without a note",
    });

    expect(connect.kind).toBe("invite");
    expect(send.kind).toBe("invite");
  });

  it("classifies a Send button label produced by formatSnapshot as a message", () => {
    const store = createSeedStore();
    const url = "https://www.linkedin.com/in/jane/";
    const label = snapshotLabel(url, "Jane | LinkedIn", {
      ref: 3,
      tag: "button",
      role: "button",
      text: "Send",
      x: 0,
      y: 0,
    });
    const entry = recordLinkedInSend(store, { ...facts, url, action: "click", label });

    expect(entry.kind).toBe("message");
  });

  it("classifies formatSnapshot invitation labels as invites within 15 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-16T10:00:00.000Z");
    const store = createSeedStore();
    const url = "https://www.linkedin.com/in/jane/";
    const connectLabel = snapshotLabel(url, "Jane | LinkedIn", {
      ref: 4,
      tag: "button",
      role: "button",
      text: "Connect",
      x: 0,
      y: 0,
    });
    const connect = recordLinkedInSend(store, {
      ...facts,
      url,
      action: "click",
      label: connectLabel,
    });

    vi.setSystemTime("2026-09-16T10:15:00.000Z");
    const sendLabel = snapshotLabel(url, "Jane | LinkedIn", {
      ref: 5,
      tag: "button",
      role: "button",
      text: "Send without a note",
      x: 0,
      y: 0,
    });
    const send = recordLinkedInSend(store, {
      ...facts,
      url,
      action: "click",
      label: sendLabel,
    });

    expect(connect.kind).toBe("invite");
    expect(send.kind).toBe("invite");
  });

  it("classifies Enter as a message without a profile slug", () => {
    const store = createSeedStore();
    const entry = recordLinkedInSend(store, {
      ...facts,
      url: "https://www.linkedin.com/messaging/thread/abc/",
      action: "press",
      key: "Enter",
    });

    expect(entry).toMatchObject({ slug: null, action: "press", key: "Enter", kind: "message" });
  });

  it("does not treat Send without a prior invitation as a message", () => {
    const store = createSeedStore();
    const entry = recordLinkedInSend(store, {
      ...facts,
      url: "https://www.linkedin.com/in/new-contact/",
      action: "click",
      label: "Send without a note",
    });
    expect(entry.kind).toBe("unknown");
  });

  it("does not treat Send as an invite when the prior invitation is older than 15 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-16T10:00:00.000Z");
    const store = createSeedStore();
    const url = "https://www.linkedin.com/in/jane-doe-123/";
    store.linkedinSendLog = [
      {
        id: "send_stale_invite",
        at: "2026-09-16T09:44:00.000Z",
        ...facts,
        url,
        slug: "jane-doe-123",
        action: "click",
        label: "Connect",
        key: null,
        text: null,
        kind: "invite",
      },
    ];
    const label = snapshotLabel(url, "Jane | LinkedIn", {
      ref: 6,
      tag: "button",
      role: "button",
      text: "Send",
      x: 0,
      y: 0,
    });

    const entry = recordLinkedInSend(store, { ...facts, url, action: "click", label });

    expect(entry.kind).toBe("message");
  });
});
