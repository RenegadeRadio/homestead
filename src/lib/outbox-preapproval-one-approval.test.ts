import { describe, expect, it } from "vitest";

import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { isOutboxPreapproved, isOutboxSendText } from "@/lib/outbox-preapproval";
import { createSeedStore } from "@/lib/seed";

function sendingItem(kind: "message" | "invite" = "message") {
  const store = createSeedStore();
  const item = createOutboxItem(store, {
    name: "Ada Lovelace",
    profileUrl: "https://www.linkedin.com/in/ada-lovelace",
    text: "Hello Ada",
    kind,
    createdBy: "operator",
  });
  approveOutboxItems(store, { ids: [item.id] });
  item.status = "sending";
  return store;
}

describe("Outbox one-approval flow", () => {
  it("pre-approves an invite Connect click based on the profile slug, not the label name", () => {
    const store = sendingItem("invite");

    expect(
      isOutboxPreapproved(store, {
        tool: "browser_click",
        url: "https://www.linkedin.com/in/ada-lovelace",
        label: '[4] button "Invite Ada Somebody Else to connect"',
        hasRef: true,
      })
    ).toBe(true);
  });

  it("pre-approves opening a message field on the matching profile", () => {
    const store = sendingItem();

    expect(
      isOutboxPreapproved(store, {
        tool: "browser_click",
        url: "https://www.linkedin.com/in/ada-lovelace",
        label: '[4] button "Message"',
        hasRef: true,
      })
    ).toBe(true);
  });

  it("never pre-approves typing and only identifies matching approved send text", () => {
    const store = sendingItem();

    expect(
      isOutboxPreapproved(store, {
        tool: "browser_type",
        url: "https://www.linkedin.com/in/ada-lovelace",
        text: "Hello Ada",
      })
    ).toBe(false);
    expect(isOutboxSendText(store, "https://www.linkedin.com/in/ada-lovelace", "Hello Bob"))
      .toBe(false);
    expect(isOutboxSendText(store, "https://www.linkedin.com/in/grace-hopper", "Hello Ada"))
      .toBe(false);
  });
});
