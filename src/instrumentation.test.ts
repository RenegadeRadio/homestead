import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/routines", () => ({
  startRoutineTicker: vi.fn(),
}));
vi.mock("@/lib/outbox-bot", () => ({
  resumeOutboxRunOnBoot: vi.fn(),
}));

import { resumeOutboxRunOnBoot } from "@/lib/outbox-bot";
import { startRoutineTicker } from "@/lib/routines";
import { register } from "./instrumentation";

describe("register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("starts the routine ticker in the nodejs runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    await register();

    expect(startRoutineTicker).toHaveBeenCalledTimes(1);
  });

  it("does not start the routine ticker in the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");

    await register();

    expect(startRoutineTicker).not.toHaveBeenCalled();
  });

  it("resumes the outbox run in the nodejs runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    await register();

    expect(resumeOutboxRunOnBoot).toHaveBeenCalledTimes(1);
  });

  it("does not resume the outbox run in the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");

    await register();

    expect(resumeOutboxRunOnBoot).not.toHaveBeenCalled();
  });
});
