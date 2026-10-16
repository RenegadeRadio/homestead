import { describe, expect, it } from "vitest";

import {
  DEFAULT_BANNED_PHRASES,
  draftCheckRefusal,
  findDraftProblems,
} from "@/lib/agent/draft-check";

describe("draft check", () => {
  it("reports each dash type once and accepts commas", () => {
    expect(findDraftProblems("One — two — three – four", [])).toEqual([
      "contains an em dash (U+2014)",
      "contains an en dash (U+2013)",
    ]);
    expect(findDraftProblems("One, two, three, four", [])).toEqual([]);
  });

  it("normalizes case, whitespace, and curly apostrophes for phrase matching", () => {
    expect(findDraftProblems("Please TOUCH   BASE tomorrow", DEFAULT_BANNED_PHRASES)).toContain(
      'contains the phrase "touch base"'
    );
    expect(findDraftProblems("Don’t   worry about it", ["don't worry"])).toEqual([
      'contains the phrase "don\'t worry"',
    ]);
  });

  it("formats the refusal text", () => {
    expect(draftCheckRefusal(["contains an em dash (U+2014)"])).toBe(
      "Draft check failed: contains an em dash (U+2014). Rewrite the text without them and try again."
    );
  });

  it("honors a custom phrase list that does not ban delve", () => {
    expect(findDraftProblems("We can delve into the details.", ["unlock the potential"])).toEqual([]);
  });
});
