import { describe, expect, it } from "vitest";
import {
  inventoryRepairNumber,
  inventoryRepairStatusLabel,
  parseInventoryRepairListRow,
} from "./inventory-reconciliation-repair";

const validRow = {
  id: "4fcbde48-05bb-45bc-8f16-7e0707ee7a03",
  repair_number: 12,
  status: "ready_for_review",
  title: "مراجعة فرق منتج",
  explanation: "فرق ظاهر في بطاقة المنتج",
  version: 2,
  prepared_at: "2026-09-14T10:00:00Z",
  submitted_at: "2026-09-14T11:00:00Z",
  approved_at: null,
  updated_at: "2026-09-14T11:00:00Z",
};

describe("inventory reconciliation repair presentation", () => {
  it("تحول سجل قاعدة البيانات إلى عقد الواجهة", () => {
    expect(parseInventoryRepairListRow(validRow)).toMatchObject({
      repairNumber: 12,
      status: "ready_for_review",
      version: 2,
      approvedAt: null,
    });
  });

  it("ترفض الحالات غير المعروفة", () => {
    expect(() => parseInventoryRepairListRow({ ...validRow, status: "posted" })).toThrow(
      "سجل معالجة المطابقة غير صالح",
    );
  });

  it("تعرض رقمًا وحالة مفهومين", () => {
    expect(inventoryRepairNumber(12)).toBe("IR-0012");
    expect(inventoryRepairStatusLabel.ready_for_review).toBe("بانتظار المراجعة");
  });
});
