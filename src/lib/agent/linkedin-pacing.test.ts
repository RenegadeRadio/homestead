import { describe, expect, it, vi } from "vitest";

import {
  checkLinkedInPacing,
  isLinkedInSearchUrl,
  isLinkedInUrl,
} from "@/lib/agent/linkedin-pacing";

describe("LinkedIn pacing", () => {
  it("recognizes only LinkedIn hosts", () => {
    expect(isLinkedInUrl("https://www.linkedin.com/feed/")).toBe(true);
    expect(isLinkedInUrl("https://linkedin.com/in/x")).toBe(true);
    expect(isLinkedInUrl("https://lnkd.in/abc123")).toBe(true);
    expect(isLinkedInUrl("https://notlinkedin.com/")).toBe(false);
    expect(isLinkedInUrl("https://linkedin.com.evil.example/")).toBe(false);
  });

  it("recognizes LinkedIn search paths", () => {
    expect(isLinkedInSearchUrl("https://www.linkedin.com/search/results/people/")).toBe(true);
    expect(isLinkedInSearchUrl("https://linkedin.com/sales/search?query=x")).toBe(true);
    expect(isLinkedInSearchUrl("https://linkedin.com/in/x")).toBe(false);
    expect(isLinkedInSearchUrl("https://example.com/search/results/people/")).toBe(false);
  });

  it("allows a first action and actions at or after the gap", () => {
    const now = new Date("2026-09-16T10:05:00.000Z");
    expect(checkLinkedInPacing(now, undefined, 300)).toEqual({ status: "allowed" });
    expect(checkLinkedInPacing(now, "2026-09-16T10:00:00.000Z", 300)).toEqual({
      status: "allowed",
    });
  });

  it("refuses an early action with the local next-allowed time", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-16T10:02:00.000Z");
    const decision = checkLinkedInPacing(
      new Date(),
      "2026-09-16T10:00:00.000Z",
      300
    );
    const next = new Date("2026-09-16T10:05:00.000Z");
    const hhmm = `${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`;

    expect(decision).toEqual({
      status: "refused",
      nextAllowedAt: next,
      message: `LinkedIn pacing: the next LinkedIn message or invite is allowed at ${hhmm}. End your turn now and try again after that.`,
    });
    vi.useRealTimers();
  });
});
