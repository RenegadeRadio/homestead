import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  browserStatus: vi.fn(),
  browserComposeText: vi.fn(),
  state: { store: undefined as unknown as import("@/lib/types").Store },
}));

vi.mock("@/lib/browser", () => ({
  browserStatus: mocks.browserStatus,
  browserComposeText: mocks.browserComposeText,
}));
vi.mock("@/lib/store", () => ({
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) =>
    fn(mocks.state.store)
  ),
}));

import { createOutboxItem } from "@/lib/outbox";
import { measureOutboxAftermath } from "@/lib/outbox-aftermath";
import { createSeedStore } from "@/lib/seed";

function createItem() {
  return createOutboxItem(mocks.state.store, {
    name: "Ada Lovelace",
    profileUrl: "https://www.linkedin.com/in/ada-lovelace",
    text: "Hello Ada",
    createdBy: "operator",
  });
}

describe("measureOutboxAftermath", () => {
  beforeEach(() => {
    mocks.state.store = createSeedStore();
    mocks.browserStatus.mockReset();
    mocks.browserComposeText.mockReset();
  });

  it("records an open compose box with text", async () => {
    const item = createItem();
    mocks.browserStatus.mockResolvedValue({ running: true });
    mocks.browserComposeText.mockResolvedValue("  hello  ");

    await measureOutboxAftermath(item.id);

    expect(item.aftermath).toMatchObject({ composeOpen: true, draftLeft: true });
    expect(item.aftermath?.at).toEqual(expect.any(String));
    expect(mocks.browserComposeText).toHaveBeenCalledOnce();
  });

  it("records an open but empty compose box as no draft left", async () => {
    const item = createItem();
    mocks.browserStatus.mockResolvedValue({ running: true });
    mocks.browserComposeText.mockResolvedValue("  \n  ");

    await measureOutboxAftermath(item.id);

    expect(item.aftermath).toMatchObject({ composeOpen: true, draftLeft: false });
  });

  it("records a closed compose box", async () => {
    const item = createItem();
    mocks.browserStatus.mockResolvedValue({ running: true });
    mocks.browserComposeText.mockResolvedValue(null);

    await measureOutboxAftermath(item.id);

    expect(item.aftermath).toMatchObject({ composeOpen: false, draftLeft: false });
  });

  it("does not inspect or record anything when the browser is not running", async () => {
    const item = createItem();
    mocks.browserStatus.mockResolvedValue({ running: false });

    await measureOutboxAftermath(item.id);

    expect(item.aftermath).toBeUndefined();
    expect(mocks.browserComposeText).not.toHaveBeenCalled();
  });
});
