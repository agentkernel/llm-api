import { describe, expect, it } from "vitest";
import { computeWindowBounds, DEFAULT_WINDOW_SIZE } from "../src/main/windowBounds";

describe("computeWindowBounds", () => {
  it("uses defaults when the work area is large enough", () => {
    expect(computeWindowBounds({ width: 1920, height: 1080 })).toEqual({
      width: 1080,
      height: 720,
      minWidth: 920,
      minHeight: 600,
    });
  });

  it("clamps size and minimums on a 200% scaled small screen (720x430)", () => {
    const bounds = computeWindowBounds({ width: 720, height: 430 });
    expect(bounds).toEqual({ width: 720, height: 430, minWidth: 720, minHeight: 430 });
  });

  it("clamps only the axis that overflows", () => {
    // 1280x720 @125% → 1024x576 DIP：宽高都小于默认值但大于最小值
    const bounds = computeWindowBounds({ width: 1024, height: 576 });
    expect(bounds).toEqual({ width: 1024, height: 576, minWidth: 920, minHeight: 576 });
  });

  it("matches the current primary display case (1440x860 leaves defaults intact)", () => {
    expect(computeWindowBounds({ width: 1440, height: 860 })).toEqual({
      width: DEFAULT_WINDOW_SIZE.width,
      height: DEFAULT_WINDOW_SIZE.height,
      minWidth: DEFAULT_WINDOW_SIZE.minWidth,
      minHeight: DEFAULT_WINDOW_SIZE.minHeight,
    });
  });

  it("never returns non-positive sizes even for degenerate work areas", () => {
    const bounds = computeWindowBounds({ width: 0, height: 0 });
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.minWidth).toBeGreaterThan(0);
    expect(bounds.minHeight).toBeGreaterThan(0);
  });
});
