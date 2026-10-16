import { describe, expect, it } from "vitest";

import { isLinkedInSendAction } from "@/lib/agent/linkedin-pacing";
import { looksLikeSend } from "@/lib/browser";

describe("LinkedIn invite pacing", () => {
  it("does not treat opening a custom invite dialog as a send", () => {
    expect(
      isLinkedInSendAction({
        kind: "click",
        label: '[3] button "Connect" /preload/custom-invite/12345',
      })
    ).toBe(false);
  });

  it.each(['[3] button "Send invitation"', '[3] button "Send without a note"'])(
    "treats an invitation send as a send action: %s",
    (label) => {
      expect(isLinkedInSendAction({ kind: "click", label })).toBe(true);
    }
  );

  it("still requires approval to click Connect", () => {
    expect(looksLikeSend('[3] button "Connect"')).toBe(true);
  });
});
