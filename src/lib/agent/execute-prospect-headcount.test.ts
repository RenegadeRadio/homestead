import { describe, expect, it } from "vitest";

import { executeTool } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";
import type { CrmProspectEntry } from "@/lib/types";

function context() {
  const store = createSeedStore();
  return {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
  };
}

function prospect(name: string, headcount: string, headcountSource?: string) {
  return {
    name,
    profileUrl: `https://www.linkedin.com/in/${name.toLowerCase().replaceAll(" ", "-")}/`,
    lane: "A",
    source: "linkedin",
    status: "queued",
    note: "Public company research.",
    company: "Analytical Engines Ltd",
    role: "Founder",
    headcount,
    ...(headcountSource === undefined ? {} : { headcountSource }),
    industry: "Software",
  };
}

describe("prospect headcount targeting", () => {
  it("stores structured fields and marks an out-of-target Lane A prospect", async () => {
    const ctx = context();

    await executeTool(
      "record_linkedin_prospect",
      prospect("Ada Lovelace", "51-200", "https://analytical.example/about"),
      ctx
    );

    expect(ctx.store.crmProspects?.[0]).toMatchObject({
      company: "Analytical Engines Ltd",
      role: "Founder",
      headcount: "51-200",
      headcountSource: "https://analytical.example/about",
      industry: "Software",
      outOfTarget: "Headcount 51-200 is outside Lane A's target (1-10, 11-50).",
    });
  });

  it("leaves an in-target or unknown Lane A prospect in target", async () => {
    const ctx = context();

    await executeTool(
      "record_linkedin_prospect",
      prospect("Ada Lovelace", "11-50", "https://analytical.example/about"),
      ctx
    );
    await executeTool("record_linkedin_prospect", prospect("Grace Hopper", "unknown"), ctx);

    expect(ctx.store.crmProspects?.[0]).toMatchObject({ headcount: "11-50" });
    expect(ctx.store.crmProspects?.[0]).not.toHaveProperty("outOfTarget");
    expect(ctx.store.crmProspects?.[1]).toMatchObject({ headcount: "unknown" });
    expect(ctx.store.crmProspects?.[1]).not.toHaveProperty("outOfTarget");
  });

  it("refuses a known headcount without its source", async () => {
    const ctx = context();

    const result = await executeTool(
      "record_linkedin_prospect",
      prospect("Ada Lovelace", "11-50"),
      ctx
    );

    expect(result.result).toBe("Refused: headcountSource is required when headcount is a band.");
    expect(ctx.store.crmProspects ?? []).toHaveLength(0);
  });

  it("refuses to queue an out-of-target prospect without changing the outbox", async () => {
    const ctx = context();
    const entry = {
      id: "prospect_target",
      at: "2026-10-05T10:00:00.000Z",
      botId: ctx.bot.id,
      name: "Ada Lovelace",
      profileUrl: "https://www.linkedin.com/in/ada-lovelace/",
      slug: null,
      lane: "A",
      source: "linkedin",
      status: "queued",
      note: "Research only.",
      outOfTarget: "Headcount 51-200 is outside Lane A's target (1-10, 11-50).",
    } satisfies CrmProspectEntry;
    ctx.store.crmProspects = [entry];
    const outboxBefore = [...(ctx.store.outbox ?? [])];

    const result = await executeTool(
      "queue_linkedin_message",
      {
        name: "Ada Lovelace",
        profileUrl: "https://linkedin.com/in/ada-lovelace",
        text: "Hello Ada",
      },
      ctx
    );

    expect(result.result).toMatch(/^Refused:/);
    expect(ctx.store.outbox ?? []).toEqual(outboxBefore);
  });

  it("filters prospects by headcount and out-of-target status", async () => {
    const ctx = context();
    await executeTool(
      "record_linkedin_prospect",
      prospect("Ada Lovelace", "11-50", "https://analytical.example/about"),
      ctx
    );
    await executeTool(
      "record_linkedin_prospect",
      prospect("Grace Hopper", "51-200", "https://compiler.example/about"),
      ctx
    );

    const byHeadcount = await executeTool(
      "list_linkedin_prospects",
      { headcount: ["11-50"] },
      ctx
    );
    const outOfTarget = await executeTool(
      "list_linkedin_prospects",
      { outOfTarget: true },
      ctx
    );

    expect(byHeadcount.result).toContain("Ada Lovelace");
    expect(byHeadcount.result).not.toContain("Grace Hopper");
    expect(outOfTarget.result).toContain("Grace Hopper");
    expect(outOfTarget.result).not.toContain("Ada Lovelace");
  });
});
