import { describe, expect, it } from "vitest";
import {
  INVENTORY_ADJUSTMENT_REASONS,
  inventoryAdjustmentReasonLabel,
  inventoryAdjustmentReasonNeedsDetail,
  inventoryAdjustmentReasonNeedsSourceReference,
  isInventoryAdjustmentReasonCode,
} from "./inventory-adjustment-reasons";

describe("عقد أسباب فروق التسوية", () => {
  it("يثبت الرموز السبعة المعتمدة في الخطة دون تكرار", () => {
    const codes = INVENTORY_ADJUSTMENT_REASONS.map((reason) => reason.code);
    expect(codes).toEqual([
      "damage", "loss", "found_stock", "internal_use", "sample", "prior_entry_error", "other",
    ]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("يرفض الرموز غير المعروفة ولا يعرض لها تسمية مضللة", () => {
    expect(isInventoryAdjustmentReasonCode("damage")).toBe(true);
    expect(isInventoryAdjustmentReasonCode("unknown")).toBe(false);
    expect(isInventoryAdjustmentReasonCode(null)).toBe(false);
    expect(inventoryAdjustmentReasonLabel("prior_entry_error")).toBe("تصحيح خطأ سابق");
    expect(inventoryAdjustmentReasonLabel("unknown")).toBeNull();
  });

  it("يميز الأسباب التي تحتاج بيانًا أو مرجع المستند الأصلي", () => {
    expect(inventoryAdjustmentReasonNeedsDetail("internal_use")).toBe(true);
    expect(inventoryAdjustmentReasonNeedsDetail("sample")).toBe(true);
    expect(inventoryAdjustmentReasonNeedsDetail("other")).toBe(true);
    expect(inventoryAdjustmentReasonNeedsDetail("damage")).toBe(false);
    expect(inventoryAdjustmentReasonNeedsSourceReference("prior_entry_error")).toBe(true);
    expect(inventoryAdjustmentReasonNeedsSourceReference("loss")).toBe(false);
  });
});
