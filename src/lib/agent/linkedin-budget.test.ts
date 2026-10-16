import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkLinkedInHold,
  checkLinkedInInviteCap,
  checkLinkedInPageBudget,
  checkLinkedInSendWindow,
  linkedInBudgetIO,
  pruneLinkedInPageLoads,
  scheduleNextLinkedInAction,
  waitForLinkedInActionGap,
} from "@/lib/agent/linkedin-budget";
import { checkLinkedInPacing, DEFAULT_LINKEDIN_GAP_SECONDS } from "@/lib/agent/linkedin-pacing";
import { createSeedStore } from "@/lib/seed";

describe("LinkedIn budget rules", () => {
  const originalSleep = linkedInBudgetIO.sleep;

  afterEach(() => {
    linkedInBudgetIO.sleep = originalSleep;
  });

  it("waits for a scheduled action and can disable action gaps", async () => {
    const settings = createSeedStore().settings;
    const sleep = vi.fn(async () => undefined);
    linkedInBudgetIO.sleep = sleep;
    settings.linkedinNextActionAt = "2026-09-22T10:01:15.000Z";

    await expect(
      waitForLinkedInActionGap(settings, () => new Date("2026-09-22T10:00:00.000Z"))
    ).resolves.toBe(75_000);
    expect(sleep).toHaveBeenCalledWith(75_000);

    settings.linkedinActionGapMinSeconds = 0;
    settings.linkedinActionGapMaxSeconds = 0;
    scheduleNextLinkedInAction(settings, new Date("2026-09-22T10:00:00.000Z"));
    expect(settings.linkedinNextActionAt).toBeUndefined();
  });

  it("enforces the forty-five-minute send gap", () => {
    const decision = checkLinkedInPacing(
      new Date("2026-09-22T10:30:00.000Z"),
      "2026-09-22T10:00:00.000Z",
      DEFAULT_LINKEDIN_GAP_SECONDS
    );
    expect(decision.status).toBe("refused");
    if (decision.status === "refused") expect(decision.message).toMatch(/^LinkedIn pacing:/);
  });

  it("uses an end-exclusive 09:00 to 18:00 SAST send window", () => {
    const atClose = checkLinkedInSendWindow(
      new Date("2026-09-22T16:00:00.000Z"),
      "09:00",
      "18:00"
    );
    expect(atClose.status).toBe("refused");
    if (atClose.status === "refused") {
      expect(atClose.nextAllowedAt.toISOString()).toBe("2026-09-23T07:00:00.000Z");
      expect(atClose.message).toContain("09:00 SAST");
    }
    expect(
      checkLinkedInSendWindow(new Date("2026-09-22T15:59:00.000Z"), "09:00", "18:00")
    ).toEqual({ status: "allowed" });
    expect(
      checkLinkedInSendWindow(new Date("2026-09-22T23:00:00.000Z"), "09:00", "09:00")
    ).toEqual({ status: "allowed" });
  });

  it("fails closed on malformed window bounds", () => {
    const decision = checkLinkedInSendWindow(
      new Date("2026-09-22T08:00:00.000Z"),
      "9:00",
      "18:00"
    );
    expect(decision.status).toBe("refused");
    if (decision.status === "refused") expect(decision.message).toMatch(/^LinkedIn send window:/);
  });

  it("skips weekends and Friday's closed window", () => {
    const saturday = checkLinkedInSendWindow(
      new Date("2026-09-26T08:00:00.000Z"),
      "09:00",
      "18:00"
    );
    const fridayClose = checkLinkedInSendWindow(
      new Date("2026-09-25T16:00:00.000Z"),
      "09:00",
      "18:00"
    );
    expect(saturday.status === "refused" && saturday.nextAllowedAt.toISOString()).toBe(
      "2026-09-28T07:00:00.000Z"
    );
    expect(fridayClose.status === "refused" && fridayClose.nextAllowedAt.toISOString()).toBe(
      "2026-09-28T07:00:00.000Z"
    );
  });

  it("caps invite sends but allows messages and a disabled cap", () => {
    const now = new Date("2026-09-22T13:00:00.000Z");
    const store = createSeedStore();
    store.linkedinSendLog = Array.from({ length: 10 }, (_, index) => ({
      id: `send-${index}`,
      at: new Date(now.getTime() - (index + 1) * 60_000).toISOString(),
      botId: "bot",
      conversationId: "conversation",
      messageId: "message",
      url: "https://www.linkedin.com/in/test",
      slug: "test",
      action: "click" as const,
      label: '[1] button "Send invitation"',
      key: null,
      text: null,
      kind: "invite" as const,
    }));
    const nextAllowedAt = new Date("2026-09-23T07:00:00.000Z");
    const capped = checkLinkedInInviteCap(now, store.linkedinSendLog, 10, nextAllowedAt);
    expect(capped.status).toBe("refused");
    if (capped.status === "refused") expect(capped.message).toMatch(/^LinkedIn invite cap:/);
    expect(checkLinkedInInviteCap(now, store.linkedinSendLog, 0, nextAllowedAt)).toEqual({
      status: "allowed",
    });
    store.linkedinSendLog[0].kind = "message";
    expect(checkLinkedInInviteCap(now, store.linkedinSendLog, 10, nextAllowedAt)).toEqual({
      status: "allowed",
    });
  });

  it("prunes page loads outside 24 hours and refuses at the budget", () => {
    const now = new Date("2026-09-22T12:00:00.000Z");
    const recent = Array.from({ length: 40 }, (_, index) =>
      new Date(now.getTime() - (index + 1) * 60_000).toISOString()
    );
    expect(checkLinkedInPageBudget(now, recent, 40).status).toBe("refused");
    expect(
      pruneLinkedInPageLoads([new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString()], now)
    ).toEqual([]);
  });

  it("formats an operator-only hold", () => {
    const settings = createSeedStore().settings;
    settings.linkedinHold = "automatic: test";
    const decision = checkLinkedInHold(settings);
    expect(decision.status).toBe("refused");
    if (decision.status === "refused") expect(decision.message).toMatch(/^LinkedIn hold:/);
  });
});
