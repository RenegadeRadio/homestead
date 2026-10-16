import { describe, expect, it } from "vitest";

import { mapShotClickToViewport } from "./live-browser";

describe("mapShotClickToViewport", () => {
  it("maps clicks through a horizontally letterboxed picture", () => {
    expect(mapShotClickToViewport(1600, 800, 800, 400, 1280, 800)).toEqual({ x: 640, y: 400 });

    const nearLeft = mapShotClickToViewport(1600, 800, 161, 400, 1280, 800);
    expect(nearLeft).toEqual({ x: 1, y: 400 });
  });

  it("reports clicks in bands above and below the picture as outside", () => {
    expect(mapShotClickToViewport(1280, 1600, 640, 100, 1280, 800)).toEqual({ outside: true });
    expect(mapShotClickToViewport(1280, 1600, 640, 1500, 1280, 800)).toEqual({ outside: true });
  });

  it("preserves the existing mapping when the aspect ratios match", () => {
    expect(mapShotClickToViewport(1280, 800, 100, 50, 1280, 800)).toEqual({ x: 100, y: 50 });
  });

  it("maps the drawn picture's bottom-right corner to the viewport's bottom-right corner", () => {
    const mapping = mapShotClickToViewport(1600, 800, 1440, 800, 1280, 800);

    expect("outside" in mapping).toBe(false);
    if ("outside" in mapping) return;
    expect(mapping.x).toBeCloseTo(1280, 0);
    expect(mapping.y).toBeCloseTo(800, 0);
  });
});
