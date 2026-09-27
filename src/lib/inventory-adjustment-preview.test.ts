import { describe, expect, it } from "vitest";
import { buildInventoryAdjustmentPreview } from "./inventory-adjustment-preview";

describe("معاينة أثر التسوية قبل الترحيل", () => {
  it("يعرض أثر الفائض والعجز منفصلين ولا يصفيهما إلى صافي واحد", () => {
    expect(buildInventoryAdjustmentPreview([
      { product_id: "p1", product_name: "الفائض", system_quantity: 8,
        actual_quantity: 9, unit_cost: 40 },
      { product_id: "p2", product_name: "العجز", system_quantity: 5,
        actual_quantity: 3, unit_cost: 25 },
    ])).toEqual([
      { productId: "p1", productName: "الفائض", beforeQuantity: 8,
        afterQuantity: 9, difference: 1, estimatedValue: 40, kind: "surplus",
        debitAccount: "1104", creditAccount: "4201" },
      { productId: "p2", productName: "العجز", beforeQuantity: 5,
        afterQuantity: 3, difference: -2, estimatedValue: 50, kind: "shortage",
        debitAccount: "5201", creditAccount: "1104" },
    ]);
  });

  it("يبقي بند الفرق الصفري في المعاينة بلا حركة أو قيد", () => {
    expect(buildInventoryAdjustmentPreview([
      { product_id: "p1", product_name: "مطابق", system_quantity: 3,
        actual_quantity: 3, unit_cost: 100 },
    ])[0]).toMatchObject({ difference: 0, estimatedValue: 0,
      kind: "matched", debitAccount: null, creditAccount: null });
  });

  it("لا يعرض الصف الفارغ كأثر ترحيل", () => {
    expect(buildInventoryAdjustmentPreview([
      { product_id: "", product_name: "", system_quantity: 0,
        actual_quantity: 0, unit_cost: 0 },
    ])).toEqual([]);
  });
});
