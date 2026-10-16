import { getConfig } from "@testing-library/dom";
import { describe, expect, it } from "vitest";

import config from "../vitest.config";

describe("test setup", () => {
  it("registers the shared setup file", () => {
    expect(config.test?.setupFiles).toEqual(["./src/test-setup.ts"]);
  });

  it("sets the Testing Library wait timeout", async () => {
    await import("./test-setup");

    expect(getConfig().asyncUtilTimeout).toBe(20_000);
  });
});
