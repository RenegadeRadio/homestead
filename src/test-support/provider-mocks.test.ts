import { expect, it } from "vitest";

import { createProviderMocks, resetProviderMocks } from "@/test-support/provider-mocks";

it("removes an unconsumed queued provider value when reset", async () => {
  const mocks = createProviderMocks();
  mocks.openaiComplete.mockResolvedValueOnce("first");

  resetProviderMocks(mocks);
  mocks.openaiComplete.mockResolvedValue("second");

  await expect(mocks.openaiComplete()).resolves.toBe("second");
});
