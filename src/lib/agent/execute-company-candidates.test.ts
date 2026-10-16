import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    browserClick: vi.fn(),
    browserNavigate: vi.fn(),
    browserPress: vi.fn(),
    browserScroll: vi.fn(),
    browserSnapshot: vi.fn(),
    browserType: vi.fn(),
    setBrowserMode: vi.fn(),
  };
});

import { executeTool } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";

function setup() {
  const store = createSeedStore();
  return {
    store,
    context: {
      store,
      bot: store.bots[0],
      conversationId: store.conversations[0].id,
      messageId: store.messages[0].id,
    },
  };
}

const criterion = {
  criterion: "Has an enterprise product",
  answer: "yes",
  url: "https://acme.co.za/about",
  quote: "We build software for enterprise teams.",
};

describe("company candidate tools", () => {
  it("records a normalized company candidate with evidence", async () => {
    const { store, context } = setup();
    const result = await executeTool(
      "record_company_candidate",
      {
        domain: "https://www.Acme.co.za/about",
        lane: "A",
        verdict: "yes",
        criteria: [criterion],
      },
      context
    );

    expect(result.result).toMatch(/^Recorded company candidate/);
    expect(store.companyCandidates?.[0]).toMatchObject({
      domain: "acme.co.za",
      lane: "A",
      verdict: "yes",
      criteria: [criterion],
    });
  });

  it.each([
    {
      domain: "acme.co.za",
      criteria: [{ ...criterion, url: "https://www.linkedin.com/company/acme" }],
    },
    { domain: "acme.co.za", criteria: [{ ...criterion, quote: undefined }] },
    { domain: "www.linkedin.com", criteria: [criterion] },
  ])("refuses LinkedIn or incomplete evidence", async (input) => {
    const { store, context } = setup();
    const result = await executeTool(
      "record_company_candidate",
      { ...input, lane: "A", verdict: "yes" },
      context
    );

    expect(result.result).toMatch(/^Refused:/);
    expect(store.companyCandidates).toBeUndefined();
  });

  it("refuses to replace a settled record", async () => {
    const { store, context } = setup();
    await executeTool(
      "record_company_candidate",
      { domain: "acme.co.za", lane: "A", verdict: "no", criteria: [criterion] },
      context
    );
    const result = await executeTool(
      "record_company_candidate",
      { domain: "www.acme.co.za", lane: "A", verdict: "yes", criteria: [criterion] },
      context
    );

    expect(result.result).toContain("already settled as no");
    expect(store.companyCandidates).toHaveLength(1);
    expect(store.companyCandidates?.[0].verdict).toBe("no");
  });

  it("replaces an unsure record while preserving its identity", async () => {
    const { store, context } = setup();
    await executeTool(
      "record_company_candidate",
      { domain: "acme.co.za", lane: "A", verdict: "unsure", criteria: [criterion] },
      context
    );
    const id = store.companyCandidates?.[0].id;
    await executeTool(
      "record_company_candidate",
      { domain: "acme.co.za", lane: "A", verdict: "yes", criteria: [criterion] },
      context
    );

    expect(store.companyCandidates).toHaveLength(1);
    expect(store.companyCandidates?.[0]).toMatchObject({ id, verdict: "yes" });
    expect(store.companyCandidates?.[0].updatedAt).toBeTruthy();
  });

  it("lists candidates using all supplied filters", async () => {
    const { context } = setup();
    await executeTool(
      "record_company_candidate",
      { domain: "acme.co.za", name: "Acme", lane: "A", verdict: "yes", criteria: [criterion] },
      context
    );
    await executeTool(
      "record_company_candidate",
      {
        domain: "other.example",
        lane: "B",
        verdict: "no",
        criteria: [{ ...criterion, answer: "no", url: "https://other.example/about" }],
      },
      context
    );

    const lane = await executeTool("list_company_candidates", { lane: "A" }, context);
    const missing = await executeTool(
      "list_company_candidates",
      { domain: "www.nomatch.example" },
      context
    );

    expect(lane.result).toContain("acme.co.za [Acme] lane A yes");
    expect(lane.result).toContain(criterion.quote);
    expect(lane.result).not.toContain("other.example");
    expect(missing.result).toBe("No company candidates match.");
  });
});
