import { describe, expect, it } from "vitest";
import {
  buildInventoryRepairDraftItem,
  getInventoryRepairItemPath,
  inventoryRepairNumber,
  inventoryRepairItemLabel,
  inventoryRepairStatusLabel,
  parseInventoryRepairEvent,
  parseInventoryRepairItem,
  parseInventoryRepairCommandResult,
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

  it("تحول بند المعالجة وتبني رابط المنتج", () => {
    const item = parseInventoryRepairItem({
      id: validRow.id,
      line_number: 1,
      axis: "product",
      issue_key: `product:${validRow.id}`,
      classification: "product_balance",
      repair_type: "rebuild_product_card",
      product_id: validRow.id,
      source_type: null,
      source_id: null,
      source_number: null,
      original_journal_entry_id: null,
      before_card_quantity: 5,
      before_movement_quantity: 4,
      before_movement_book_value: 100,
      before_ledger_1104_value: null,
      proposed_card_quantity: 4,
      proposed_movement_book_value: null,
      proposed_ledger_1104_value: null,
      result_status: "pending",
      result_message: null,
      before_state: { name: "منتج اختبار", code: "P-1" },
      proposed_state: { card_quantity: 4 },
    });
    expect(inventoryRepairItemLabel(item)).toBe("منتج اختبار — P-1");
    expect(getInventoryRepairItemPath(item)).toBe(`/products/${validRow.id}`);
  });

  it("ترفض حدثًا بحالة انتقال غير معروفة", () => {
    expect(() => parseInventoryRepairEvent({
      id: validRow.id,
      event_type: "created",
      from_status: null,
      to_status: "posted",
      actor_id: validRow.id,
      created_at: validRow.prepared_at,
    })).toThrow("سجل معالجة المطابقة غير صالح");
  });

  it("تبني بند مسودة مصدر من التصنيف دون اختيار يدوي لنوع المعالجة", () => {
    expect(buildInventoryRepairDraftItem({
      kind: "source",
      classification: "rounding",
      canPrepareRepair: true,
      sourceKey: `purchase_invoice:${validRow.id}`,
      sourceType: "purchase_invoice",
      sourceId: validRow.id,
    })).toEqual({
      axis: "source",
      issue_key: `purchase_invoice:${validRow.id}`,
      classification: "rounding",
      repair_type: "post_rounding_adjustment",
      source_type: "purchase_invoice",
      source_id: validRow.id,
      proposed_state: {},
    });
  });

  it("ترفض إعداد مسودة لسجل لم تسمح به دالة التشخيص", () => {
    expect(() => buildInventoryRepairDraftItem({
      kind: "product",
      classification: "matched",
      canPrepareRepair: false,
      productId: validRow.id,
    })).toThrow("غير متاح");
  });

  it("تتحقق من نتيجة أمر إنشاء المسودة", () => {
    expect(parseInventoryRepairCommandResult({
      id: validRow.id,
      repair_number: 1,
      status: "draft",
      version: 1,
    })).toEqual({ id: validRow.id, repairNumber: 1, status: "draft", version: 1 });
  });
});
