import { vi } from "vitest";

export function createProviderMocks() {
  return {
    openaiComplete: vi.fn(),
    anthropicComplete: vi.fn(),
  };
}

export function resetProviderMocks(mocks: ReturnType<typeof createProviderMocks>) {
  mocks.openaiComplete.mockReset();
  mocks.anthropicComplete.mockReset();
}
