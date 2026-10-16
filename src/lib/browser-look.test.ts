import { describe, expect, it } from "vitest";

import { formatLook } from "@/lib/browser";

describe("formatLook", () => {
  it("includes the element ref, label, and pixel position", () => {
    const result = formatLook([
      { ref: 31, tag: "a", role: "link", text: "Message", x: 157, y: 536 },
    ]);

    expect(result).toContain("[31]");
    expect(result).toContain("Message");
    expect(result).toContain("at (157,536)");
  });
});
