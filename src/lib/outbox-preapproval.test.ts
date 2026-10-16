import { beforeEach, describe, expect, it } from "vitest";

import { rememberTypedText } from "@/lib/agent/linkedin-send-log";
import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { isOutboxPreapproved } from "@/lib/outbox-preapproval";
import { createSeedStore } from "@/lib/seed";

describe("isOutboxPreapproved", () => {
  const profileUrl = "https://www.linkedin.com/in/ada-lovelace";
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
  });

  it("accepts only the exact approved typing on the named profile", () => {
    expect(isOutboxPreapproved(store, {
      tool: "browser_type",
      url: profileUrl,
      text: "Hello Ada\n",
    })).toBe(false);
    expect(isOutboxPreapproved(store, {
      tool: "browser_type",
      url: profileUrl,
      text: "Hello Bob\n",
    })).toBe(false);
    expect(isOutboxPreapproved(store, {
      tool: "browser_type",
      url: "https://www.linkedin.com/in/grace-hopper",
      text: "Hello Ada\n",
    })).toBe(false);
  });

  it("accepts a ref Send only after the approved text was typed", () => {
    expect(isOutboxPreapproved(store, {
      tool: "browser_click",
      url: profileUrl,
      label: '[4] button "Send"',
      hasRef: true,
    })).toBe(false);
    rememberTypedText(profileUrl, "Hello Ada");
    expect(isOutboxPreapproved(store, {
      tool: "browser_click",
      url: profileUrl,
      label: '[4] button "Send"',
      hasRef: true,
      composeText: "Ada Lovelace",
    })).toBe(true);
    expect(isOutboxPreapproved(store, {
      tool: "browser_click",
      url: profileUrl,
      label: '[4] button "Send"',
      hasRef: false,
    })).toBe(false);
  });
});
