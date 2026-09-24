import { describe, expect, it } from "vitest";
import { formatInventoryAdjustmentNumber } from "./inventory-adjustment-number";

describe("ترقيم تسويات المخزون", () => {
  it("يعرض رقمًا داخليًا للمسودة دون البادئة الرسمية", () => {
    expect(formatInventoryAdjustmentNumber("draft", 18, null)).toBe("#18");
  });

  it("يعرض رقم الترحيل المستقل بأربع خانات", () => {
    expect(formatInventoryAdjustmentNumber("posted", 18, 1)).toBe("ADJ-0001");
    expect(formatInventoryAdjustmentNumber("cancelled", 18, 1)).toBe("ADJ-0001");
  });

  it("يبقي أرقام السجلات القديمة دون إعادة ترقيم", () => {
    expect(formatInventoryAdjustmentNumber("approved", 2, null)).toBe("ADJ-0002");
    expect(formatInventoryAdjustmentNumber("posted", 990028, null)).toBe("ADJ-990028");
  });
});
