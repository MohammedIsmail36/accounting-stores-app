import { describe, expect, it } from "vitest";
import {
  calculateLegacyAdjustmentLine,
  summarizeLegacyAdjustment,
} from "./inventory-adjustment-legacy";

describe("عقد حساب تسوية المخزون الحالية", () => {
  it("يحسب الفائض من الفعلي ناقص كمية النظام", () => {
    expect(calculateLegacyAdjustmentLine(10, 13, 25)).toEqual({
      difference: 3,
      totalCost: 75,
    });
  });

  it("يحفظ العجز بإشارة سالبة وقيمة مطلقة موجبة", () => {
    expect(calculateLegacyAdjustmentLine(10, 7, 25)).toEqual({
      difference: -3,
      totalCost: 75,
    });
  });

  it("يثبت أن تطابق الكمية ينتج فرقًا وقيمة صفريين", () => {
    expect(calculateLegacyAdjustmentLine(10, 10, 25)).toEqual({
      difference: 0,
      totalCost: 0,
    });
  });

  it("يدعم الكميات العشرية دون تغيير حساب الشاشة الحالي", () => {
    expect(calculateLegacyAdjustmentLine(2.5, 2.25, 40)).toEqual({
      difference: -0.25,
      totalCost: 10,
    });
  });

  it("يفصل إجمالي الفائض والعجز ويحسب الصافي القديم", () => {
    expect(
      summarizeLegacyAdjustment([
        { product_id: "p1", difference: 2, total_cost: 100 },
        { product_id: "p2", difference: -1, total_cost: 70 },
        { product_id: "p3", difference: 0, total_cost: 0 },
      ]),
    ).toEqual({
      totalGain: 100,
      totalLoss: 70,
      netDifference: 30,
      zeroDifferenceProductCount: 1,
    });
  });

  it("لا يحسب السطر الفارغ ضمن بنود فرق الصفر", () => {
    expect(
      summarizeLegacyAdjustment([
        { product_id: "", difference: 0, total_cost: 0 },
      ]).zeroDifferenceProductCount,
    ).toBe(0);
  });
});
