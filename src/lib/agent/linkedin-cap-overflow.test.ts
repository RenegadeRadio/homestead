import { describe, expect, it } from "vitest";

import {
  checkLinkedInPageBudget,
  checkLinkedInWeeklyInviteCap,
} from "@/lib/agent/linkedin-budget";
import type { LinkedInSendEntry } from "@/lib/types";

const NOW = new Date("2026-09-25T13:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

function sendEntry(hoursAgo: number, index: number): LinkedInSendEntry {
  return {
    id: `send-invite-${hoursAgo}-${index}`,
    at: new Date(NOW.getTime() - hoursAgo * HOUR_MS).toISOString(),
    botId: "bot",
    conversationId: "conversation",
    messageId: "message",
    url: "https://www.linkedin.com/in/test",
    slug: "test",
    action: "click",
    label: '[1] button "Send"',
    key: null,
    text: null,
    kind: "invite",
  };
}

describe("LinkedIn cap overflow", () => {
  it("waits for enough weekly invites to leave the window", () => {
    const log = [
      ...Array.from({ length: 34 }, (_, index) => sendEntry(index + 1, index)),
      sendEntry(100, 34),
      sendEntry(101, 35),
    ];

    const decision = checkLinkedInWeeklyInviteCap(NOW, log, 35);

    expect(decision.status).toBe("refused");
    expect(decision.status === "refused" && decision.nextAllowedAt.toISOString()).toBe(
      "2026-09-28T09:00:00.000Z"
    );
    expect(decision.status === "refused" && decision.message).toContain(
      "11:00 on 2026-09-28"
    );
  });

  it("waits for enough page loads to leave the window", () => {
    const hoursAgo = [
      23,
      22,
      21,
      ...Array.from({ length: 39 }, (_, index) => (index % 20) + 1),
    ];
    const loads = hoursAgo.map((hours) =>
      new Date(NOW.getTime() - hours * HOUR_MS).toISOString()
    );

    const decision = checkLinkedInPageBudget(NOW, loads, 40);

    expect(decision.status).toBe("refused");
    expect(decision.status === "refused" && decision.nextAllowedAt.toISOString()).toBe(
      "2026-09-25T16:00:00.000Z"
    );
  });
});
