import { describe, expect, it } from "vitest";

import { executeTool } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";

function prospect(name: string, slug: string, country?: string) {
  return {
    name,
    profileUrl: `https://www.linkedin.com/in/${slug}/`,
    lane: "B",
    source: "linkedin",
    status: "queued",
    note: "Research only.",
    ...(country !== undefined ? { country } : {}),
  };
}

describe("record_linkedin_prospects country", () => {
  it("refuses an empty country by name while recording the rest of the batch", async () => {
    const store = createSeedStore();

    const result = await executeTool(
      "record_linkedin_prospects",
      {
        prospects: [
          prospect("Ada Lovelace", "ada-lovelace", "United Kingdom"),
          prospect("Grace Hopper", "grace-hopper", "   "),
          prospect("Katherine Johnson", "katherine-johnson"),
        ],
      },
      {
        store,
        bot: store.bots[0],
        conversationId: store.conversations[0].id,
        messageId: store.messages[0].id,
      }
    );

    expect(store.crmProspects?.map((entry) => entry.name)).toEqual([
      "Ada Lovelace",
      "Katherine Johnson",
    ]);
    expect(store.crmProspects?.[0].country).toBe("United Kingdom");
    expect(store.crmProspects?.[1]).not.toHaveProperty("country");
    expect(result.result).toContain("Grace Hopper: Refused: country must not be empty.");
  });
});
