import { describe, expect, it } from "vitest";
import { calculatePeriodGrowth } from "./period-comparison";

describe("calculatePeriodGrowth", () => {
  it("does not invent 100% growth when the previous period is zero", () => {
    expect(calculatePeriodGrowth(191_235, 0)).toBeNull();
    expect(calculatePeriodGrowth(0, 0)).toBeNull();
  });

  it("calculates positive and negative growth against a real baseline", () => {
    expect(calculatePeriodGrowth(150, 100)).toBe(50);
    expect(calculatePeriodGrowth(75, 100)).toBe(-25);
  });

  it("rejects non-finite inputs", () => {
    expect(calculatePeriodGrowth(Number.NaN, 100)).toBeNull();
    expect(calculatePeriodGrowth(100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
