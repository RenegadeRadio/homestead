import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "../vitest.config";

describe("vitest.config", () => {
  it("sets test and hook timeouts", () => {
    expect(config.test?.testTimeout).toBe(30_000);
    expect(config.test?.hookTimeout).toBe(60_000);
  });

  it("maps the @ alias to the src directory", () => {
    const alias = config.resolve?.alias as Record<string, string> | undefined;

    expect(path.resolve(String(alias?.["@"]))).toBe(
      path.resolve(process.cwd(), "src"),
    );
  });
});
