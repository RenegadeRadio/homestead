import { beforeEach, describe, expect, it } from "vitest";

import { rememberTypedText } from "@/lib/agent/linkedin-send-log";
import { approveOutboxItems, createOutboxItem, sha256Hex } from "@/lib/outbox";
import { isOutboxPreapproved, isOutboxSendText } from "@/lib/outbox-preapproval";
import { createSeedStore } from "@/lib/seed";

describe("isOutboxPreapproved message safety", () => {
  const profileUrl = "https://www.linkedin.com/in/ada-lovelace-compose-safety";
  let store: ReturnType<typeof createSeedStore>;

  beforeEach(() => {
    store = createSeedStore();
    const item = createOutboxItem(store, {
      name: "Ada Lovelace",
      profileUrl,
      text: "Hello Ada",
      createdBy: "operator",
    });
    approveOutboxItems(store, { ids: [item.id] });
    item.status = "sending";
    rememberTypedText(profileUrl, "Hello Ada");
  });

  it("requires the open compose dialog to identify the recipient", () => {
    const action = {
      tool: "browser_click" as const,
      url: profileUrl,
      label: '[4] button "Send"',
      hasRef: true,
    };

    expect(isOutboxPreapproved(store, { ...action, composeText: null })).toBe(false);
    expect(
      isOutboxPreapproved(store, { ...action, composeText: "Charles Babbage Active now" })
    ).toBe(false);
    expect(
      isOutboxPreapproved(store, { ...action, composeText: "Ada Lovelace Active now" })
    ).toBe(true);
  });

  it("rejects every action when two Outbox items are sending", () => {
    const second = createOutboxItem(store, {
      name: "Charles Babbage",
      profileUrl: "https://www.linkedin.com/in/charles-babbage-compose-safety",
      text: "Hello Charles",
      createdBy: "operator",
    });
    approveOutboxItems(store, { ids: [second.id] });
    second.status = "sending";

    expect(
      isOutboxPreapproved(store, {
        tool: "browser_type",
        url: profileUrl,
        text: "Hello Ada",
      })
    ).toBe(false);
  });

  it("rejects approved typing after the item text changes without re-approval", () => {
    const item = store.outbox?.find((candidate) => candidate.status === "sending");
    expect(item).toBeDefined();
    item!.text = "Changed after approval";
    expect(item!.approvedTextHash).not.toBe(sha256Hex(item!.text));

    expect(
      isOutboxSendText(store, profileUrl, "Hello Ada")
    ).toBe(false);
  });
});
