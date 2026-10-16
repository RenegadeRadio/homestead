import { describe, expect, it } from "vitest";

import { DEFAULT_STANDING_RULES } from "@/lib/agent/draft-check";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import { createSeedStore } from "@/lib/seed";

describe("buildSystemPrompt standing rules", () => {
  it("includes the default when the setting is unset", () => {
    const store = createSeedStore();

    expect(buildSystemPrompt(store.bots[0], store)).toContain(
      `Standing rules for client-facing text:\n${DEFAULT_STANDING_RULES}`
    );
  });

  it("includes configured standing rules instead of the default", () => {
    const store = createSeedStore();
    store.settings.standingRules = "Use the customer's preferred greeting.";
    const prompt = buildSystemPrompt(store.bots[0], store);

    expect(prompt).toContain(
      "Standing rules for client-facing text:\nUse the customer's preferred greeting."
    );
    expect(prompt).not.toContain(DEFAULT_STANDING_RULES);
  });
});
