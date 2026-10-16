import { describe, expect, it } from "vitest";

import {
  DEFAULT_LINKEDIN_GAP_SECONDS,
  isLinkedInSendAction,
} from "@/lib/agent/linkedin-pacing";

describe("LinkedIn send actions", () => {
  it("defaults the pacing gap to forty-five minutes", () => {
    expect(DEFAULT_LINKEDIN_GAP_SECONDS).toBe(2700);
  });

  it.each([
    '[3] button "Send"',
    '[3] button "send"',
    '[3] button “Send without a note”',
  ])("recognizes a real click action: %s", (label) => {
    expect(isLinkedInSendAction({ kind: "click", label })).toBe(true);
  });

  it.each([
    '[3] link "Send a message to Blaise Pascal"',
    '[3] button "Message"',
    '[3] button "Connect"',
    '[3] button "Invite"',
    '[3] button "Invitation pending"',
  ])("rejects a non-send click: %s", (label) => {
    expect(isLinkedInSendAction({ kind: "click", label })).toBe(false);
  });

  it("rejects a click without a label", () => {
    expect(isLinkedInSendAction({ kind: "click" })).toBe(false);
  });

  it("recognizes newline typing only", () => {
    expect(isLinkedInSendAction({ kind: "type", text: "hello\n" })).toBe(true);
    expect(isLinkedInSendAction({ kind: "type", text: "hello" })).toBe(false);
  });

  it.each(["Enter", "NumpadEnter", "Shift+Enter"])("recognizes %s", (key) => {
    expect(isLinkedInSendAction({ kind: "press", key })).toBe(true);
  });

  it("rejects other keys", () => {
    expect(isLinkedInSendAction({ kind: "press", key: "Tab" })).toBe(false);
  });
});
