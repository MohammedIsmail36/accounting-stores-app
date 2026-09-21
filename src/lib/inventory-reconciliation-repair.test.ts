import { describe, expect, it } from "vitest";
import {
  buildInventoryRepairDraftItem,
  buildInventoryRepairUpdateItem,
  canPrepareInventoryRepairDraft,
  canExecuteInventoryProductCardRepair,
  getInventoryRepairItemPath,
  inventoryRepairNumber,
  inventoryRepairItemLabel,
  inventoryRepairActorLabel,
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

  it("تقصر التنفيذ على معالجة إعادة بطاقة معتمدة وكل بنودها معلقة وصالحة", () => {
    const repair = {
      ...parseInventoryRepairListRow({ ...validRow, status: "approved", version: 3 }),
      diagnosticFingerprint: "fingerprint",
      diagnosticSnapshotAt: validRow.updated_at,
      sourceScope: "all_recorded_stock_effects",
      accountingDate: null,
      separationOverrideReason: null,
      preparedBy: validRow.id,
      submittedBy: validRow.id,
      approvedBy: validRow.id,
      executedBy: null,
      cancelledBy: null,
      cancellationReason: null,
    };
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
      before_state: {
        name: "منتج اختبار",
        code: "P-1",
        brand_name: "ماركة اختبار",
        model_number: "M-1",
      },
      proposed_state: { card_quantity: 4 },
    });
    expect(canExecuteInventoryProductCardRepair(repair, [item])).toBe(true);
    expect(canExecuteInventoryProductCardRepair(repair, [{ ...item, repairType: "post_rounding_adjustment" }])).toBe(false);
    expect(canExecuteInventoryProductCardRepair({ ...repair, status: "executed" }, [item])).toBe(false);
  });

  it("تعرض منفذ الحدث باسمه ودوره دون كشف المعرّف الداخلي", () => {
    expect(inventoryRepairActorLabel({ fullName: "محمد إسماعيل", role: "admin" }))
      .toBe("محمد إسماعيل — مدير");
    expect(inventoryRepairActorLabel()).toBe("مستخدم مخوّل");
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
      before_state: {
        name: "منتج اختبار",
        code: "P-1",
        brand_name: "ماركة اختبار",
        model_number: "M-1",
      },
      proposed_state: { card_quantity: 4 },
    });
    expect(inventoryRepairItemLabel(item)).toBe("[P-1] منتج اختبار - ماركة اختبار - M-1");
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
    expect(canPrepareInventoryRepairDraft({
      kind: "product",
      classification: "matched",
      canPrepareRepair: true,
      productId: validRow.id,
    })).toBe(false);
  });

  it("تتحقق من نتيجة أمر إنشاء المسودة", () => {
    expect(parseInventoryRepairCommandResult({
      id: validRow.id,
      repair_number: 1,
      status: "draft",
      version: 1,
    })).toEqual({ id: validRow.id, repairNumber: 1, status: "draft", version: 1 });
  });

  it("تعيد تجهيز بند المصدر الحالي لتعديل المسودة دون تغيير هويته", () => {
    const item = parseInventoryRepairItem({
      id: validRow.id,
      line_number: 1,
      axis: "source",
      issue_key: `purchase_invoice:${validRow.id}`,
      classification: "rounding",
      repair_type: "post_rounding_adjustment",
      product_id: null,
      source_type: "purchase_invoice",
      source_id: validRow.id,
      source_number: "24",
      original_journal_entry_id: null,
      before_card_quantity: null,
      before_movement_quantity: 109,
      before_movement_book_value: 20759.99,
      before_ledger_1104_value: 20760,
      proposed_card_quantity: null,
      proposed_movement_book_value: null,
      proposed_ledger_1104_value: null,
      result_status: "pending",
      result_message: null,
      before_state: {},
      proposed_state: {},
    });
    expect(buildInventoryRepairUpdateItem(item)).toEqual({
      axis: "source",
      issue_key: `purchase_invoice:${validRow.id}`,
      classification: "rounding",
      repair_type: "post_rounding_adjustment",
      source_type: "purchase_invoice",
      source_id: validRow.id,
      proposed_movement_book_value: null,
      proposed_ledger_1104_value: null,
      proposed_state: {},
    });
  });
});
