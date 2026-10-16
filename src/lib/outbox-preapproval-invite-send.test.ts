import { describe, expect, it } from "vitest";

import { rememberTypedText } from "@/lib/agent/linkedin-send-log";
import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { isOutboxPreapproved } from "@/lib/outbox-preapproval";
import { createSeedStore } from "@/lib/seed";

const baseUrl = "https://www.linkedin.com/in/ada-lovelace-invite-send";

function setupSendingInvite(url: string, itemText: string, typedText = itemText) {
  const store = createSeedStore();
  const item = createOutboxItem(store, {
    name: "Ada Lovelace",
    profileUrl: url,
    text: itemText,
    createdBy: "operator",
    kind: "invite",
  });
  approveOutboxItems(store, { ids: [item.id] });
  item.status = "sending";
  rememberTypedText(url, typedText);
  return { store, item };
}

describe("isOutboxPreapproved invite sending", () => {
  it("accepts exactly Send invitation without checking compose text", () => {
    const profileUrl = `${baseUrl}-accepts`;
    const { store } = setupSendingInvite(profileUrl, "Hello Ada");

    expect(
      isOutboxPreapproved(store, {
        tool: "browser_click",
        url: profileUrl,
        label: '[4] button "Send invitation"',
        hasRef: true,
        composeText: null,
      })
    ).toBe(true);
  });

  it.each<[string | null, string]>([
    [null, `${baseUrl}-reject-send-null`],
    ["Ada Lovelace", `${baseUrl}-reject-send-name`],
  ])("rejects Send with compose text %s", (composeText, profileUrl) => {
    const { store } = setupSendingInvite(profileUrl, "Hello Ada");

    expect(
      isOutboxPreapproved(store, {
        tool: "browser_click",
        url: profileUrl,
        label: '[4] button "Send"',
        hasRef: true,
        composeText,
      })
    ).toBe(false);
  });

  it("rejects Send without a note", () => {
    const profileUrl = `${baseUrl}-reject-without-note`;
    const { store } = setupSendingInvite(profileUrl, "Hello Ada");

    expect(
      isOutboxPreapproved(store, {
        tool: "browser_click",
        url: profileUrl,
        label: '[4] button "Send without a note"',
        hasRef: true,
        composeText: "Ada Lovelace",
      })
    ).toBe(false);
  });

  it("rejects Send with matching typed text and correct compose text", () => {
    const profileUrl = `${baseUrl}-new-send`;
    const { store } = setupSendingInvite(profileUrl, "Hello Ada");

    expect(
      isOutboxPreapproved(store, {
        tool: "browser_click",
        url: profileUrl,
        label: '[4] button "Send"',
        hasRef: true,
        composeText: "Ada Lovelace",
      })
    ).toBe(false);
  });

  it("rejects Send without a note with matching typed text", () => {
    const profileUrl = `${baseUrl}-new-send-without-note`;
    const { store } = setupSendingInvite(profileUrl, "Hello Ada");

    expect(
      isOutboxPreapproved(store, {
        tool: "browser_click",
        url: profileUrl,
        label: '[4] button "Send without a note"',
        hasRef: true,
        composeText: "Ada Lovelace",
      })
    ).toBe(false);
  });

  it("rejects Send invitation when typed text does not match the approved text", () => {
    const profileUrl = `${baseUrl}-typed-mismatch`;
    const { store } = setupSendingInvite(profileUrl, "Hello Ada", "Hello Ada extra");

    expect(
      isOutboxPreapproved(store, {
        tool: "browser_click",
        url: profileUrl,
        label: '[4] button "Send invitation"',
        hasRef: true,
        composeText: null,
      })
    ).toBe(false);
  });
});
