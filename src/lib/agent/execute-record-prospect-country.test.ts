import { describe, expect, it } from "vitest";

import { executeTool } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";

function context() {
  const store = createSeedStore();
  return {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
  };
}

function prospect(country?: string) {
  return {
    name: "Ada Lovelace",
    profileUrl: "https://www.linkedin.com/in/ada-lovelace/",
    lane: "B",
    source: "linkedin",
    status: "queued",
    note: "Research only.",
    ...(country !== undefined ? { country } : {}),
  };
}

describe("record_linkedin_prospect country", () => {
  it("trims surrounding whitespace and keeps the country text as given", async () => {
    const ctx = context();

    await executeTool("record_linkedin_prospect", prospect("  South Africa  "), ctx);

    expect(ctx.store.crmProspects?.[0].country).toBe("South Africa");
  });

  it("records a prospect without a country and does not add a country key", async () => {
    const ctx = context();

    const result = await executeTool("record_linkedin_prospect", prospect(), ctx);

    expect(result.result).toBe("Recorded Ada Lovelace in the CRM (not contacted).");
    expect(ctx.store.crmProspects).toHaveLength(1);
    expect(ctx.store.crmProspects?.[0]).not.toHaveProperty("country");
  });

  it.each(["", "   "])("refuses an empty country %#", async (country) => {
    const ctx = context();
    const logsBefore = ctx.store.computerLogs.length;

    const result = await executeTool("record_linkedin_prospect", prospect(country), ctx);

    expect(result.result).toBe("Refused: country must not be empty.");
    expect(ctx.store.crmProspects?.length ?? 0).toBe(0);
    expect(ctx.store.computerLogs).toHaveLength(logsBefore);
  });
});
