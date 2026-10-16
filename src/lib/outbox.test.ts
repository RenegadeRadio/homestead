import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  approveOutboxItems,
  createOutboxItem,
  updateOutboxItem,
} from "@/lib/outbox";
import { createSeedStore } from "@/lib/seed";

describe("outbox operations", () => {
  it("refuses invalid drafts and profile URLs without storing them", () => {
    const store = createSeedStore();

    expect(() =>
      createOutboxItem(store, {
        name: "Ada",
        profileUrl: "https://www.linkedin.com/in/ada",
        text: "Hello \u2014 there",
        createdBy: "operator",
      })
    ).toThrow(/^Draft check failed:/);
    expect(store.outbox ?? []).toEqual([]);

    expect(() =>
      createOutboxItem(store, {
        name: "Ada",
        profileUrl: "https://example.com/in/x",
        text: "Hello there",
        createdBy: "operator",
      })
    ).toThrow("Not a LinkedIn profile URL.");
    expect(store.outbox ?? []).toEqual([]);
  });

  it("hashes approved text and makes edited text a draft again", () => {
    const store = createSeedStore();
    const item = createOutboxItem(store, {
      name: "Ada",
      profileUrl: "https://www.linkedin.com/in/ada",
      text: "Hello there",
      createdBy: "operator",
    });

    approveOutboxItems(store, { ids: [item.id] });
    expect(item.status).toBe("approved");
    expect(item.approvedTextHash).toBe(
      createHash("sha256").update("Hello there", "utf8").digest("hex")
    );

    updateOutboxItem(store, { id: item.id, text: "Updated hello" });
    expect(item.status).toBe("draft");
    expect(item.approvedTextHash).toBeUndefined();
  });
});
