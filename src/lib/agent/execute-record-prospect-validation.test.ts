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

describe("record_linkedin_prospect validation", () => {
  it("refuses an invalid lane without recording or logging", async () => {
    const ctx = context();
    const prospectsBefore = ctx.store.crmProspects?.length ?? 0;
    const logsBefore = ctx.store.computerLogs.length;

    const result = await executeTool(
      "record_linkedin_prospect",
      {
        name: "Ada Lovelace",
        profileUrl: "https://www.linkedin.com/in/ada-lovelace/",
        lane: "Lane B",
        source: "linkedin",
        status: "queued",
        note: "Research only.",
      },
      ctx
    );

    expect(result.result).toContain("lane");
    expect(result.result).toContain('"A"');
    expect(result.result).toContain('"B"');
    expect(ctx.store.crmProspects?.length ?? 0).toBe(prospectsBefore);
    expect(ctx.store.computerLogs).toHaveLength(logsBefore);
  });

  it("refuses a Sales Navigator lead URL without recording or logging", async () => {
    const ctx = context();
    const prospectsBefore = ctx.store.crmProspects?.length ?? 0;
    const logsBefore = ctx.store.computerLogs.length;

    const result = await executeTool(
      "record_linkedin_prospect",
      {
        name: "Ada Lovelace",
        profileUrl: "https://www.linkedin.com/sales/lead/ACwAAA0000000000000000000000000000000000",
        lane: "B",
        source: "linkedin",
        status: "queued",
        note: "Research only.",
      },
      ctx
    );

    expect(result.result).toContain("public LinkedIn profile URL");
    expect(result.result).toContain("linkedin.com/in/<slug>");
    expect(result.result).toContain("Sales Navigator");
    expect(ctx.store.crmProspects?.length ?? 0).toBe(prospectsBefore);
    expect(ctx.store.computerLogs).toHaveLength(logsBefore);
  });
});
