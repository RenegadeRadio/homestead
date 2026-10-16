import { describe, expect, it } from "vitest";

import { parsePlaybookDrafts } from "@/lib/outbox-import";

describe("parsePlaybookDrafts", () => {
  it("parses sendable headings, lanes, and soft-wrapped paragraphs", () => {
    const result = parsePlaybookDrafts(`### Katherine Johnson · Lane A · free build
> First soft-wrapped
> sentence.

### Ada Lovelace
> First paragraph.
>
> Second soft-wrapped
> paragraph.`);

    expect(result.drafts).toEqual([
      {
        name: "Katherine Johnson",
        text: "First soft-wrapped sentence.",
        lane: "A",
      },
      {
        name: "Ada Lovelace",
        text: "First paragraph.\n\nSecond soft-wrapped paragraph.",
      },
    ]);
    expect(result.refused).toEqual([]);
  });

  it("keeps research lines as a note and omits an absent note", () => {
    const result = parsePlaybookDrafts(`### Grace Hopper

**Checked:** Export and company site.
Second research line.

> Hello Grace.

### Katherine Johnson
> Hello Katherine.`);

    expect(result.drafts[0].note).toBe(
      "**Checked:** Export and company site.\nSecond research line."
    );
    expect(result.drafts[1]).not.toHaveProperty("note");
  });

  it("refuses do-not-send headings and headings without draft text", () => {
    const result = parsePlaybookDrafts(`### John Napier · ⛔ DO NOT SEND
> This must not be imported.

### No Draft Person · Lane B
**Checked:** No suitable message yet.`);

    expect(result.drafts).toEqual([]);
    expect(result.refused).toEqual([
      { name: "John Napier", reason: "Marked do not send." },
      { name: "No Draft Person", reason: "No draft text found below the heading." },
    ]);
  });
});
