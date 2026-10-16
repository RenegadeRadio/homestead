import { describe, expect, it } from "vitest";

import { rememberTypedText } from "@/lib/agent/linkedin-send-log";
import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { isOutboxPreapproved } from "@/lib/outbox-preapproval";
import { createSeedStore } from "@/lib/seed";

describe("isOutboxPreapproved message sending", () => {
  it("rejects Send when compose text is null", () => {
    const profileUrl = "https://www.linkedin.com/in/ada-lovelace-message-send";
    const store = createSeedStore();
    const item = createOutboxItem(store, {
      name: "Ada Lovelace",
      profileUrl,
      text: "Hello Ada",
      createdBy: "operator",
      kind: "message",
    });
    approveOutboxItems(store, { ids: [item.id] });
    item.status = "sending";
    rememberTypedText(profileUrl, item.text);

    expect(
      isOutboxPreapproved(store, {
        tool: "browser_click",
        url: profileUrl,
        label: '[4] button "Send"',
        hasRef: true,
        composeText: null,
      })
    ).toBe(false);
  });
});
