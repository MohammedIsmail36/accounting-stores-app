import { describe, expect, it } from "vitest";
import {
  formatInventorySourceNumber,
  getInventorySourcePath,
  isReconciliationSnapshotStale,
  parseInventoryReconciliationDiagnostic,
  type InventoryReconciliationSourceRow,
} from "./inventory-reconciliation-diagnostic";

const payload = {
  schema_version: 1,
  snapshot_at: "2026-09-13T20:00:00Z",
  source_scope: "all_recorded_stock_effects",
  fingerprint: "abc123",
  status: "rounding_only",
  totals: {
    card_quantity: "3880",
    movement_quantity: 3880,
    quantity_difference: 0,
    movement_book_value: 483717.12,
    wac_valuation: 483378.34,
    ledger_1104_balance: 483717.14,
    movement_to_ledger_difference: 0.02,
    wac_to_movement_difference: -338.78,
    wac_to_ledger_difference: 338.8,
    product_issue_count: 0,
    source_issue_count: 2,
    rounding_issue_count: 2,
    unlinked_movement_count: 0,
    unlinked_journal_count: 0,
  },
  issue_counts: {
    products: 0,
    sources: 2,
    rounding: 2,
    unlinked_movements: 0,
    unlinked_journals: 0,
  },
  page: { section: "products", limit: 50, offset: 0, total_count: 1 },
  rows: [
    {
      product_id: "product-1",
      code: "P-1",
      name: "منتج اختبار",
      brand_name: "ماركة اختبار",
      model_number: "M-1",
      is_active: true,
      card_quantity: 10,
      movement_quantity: 10,
      quantity_difference: 0,
      movement_book_value: 100,
      book_unit_cost: 10,
      wac: 9.5,
      wac_valuation: 95,
      wac_to_movement_difference: -5,
      last_movement_date: "2026-09-13",
      movement_count: 2,
      classification: "matched",
      reason_codes: [],
      can_prepare_repair: true,
    },
  ],
};

describe("parseInventoryReconciliationDiagnostic", () => {
  it("يحوّل عقد الدالة إلى نموذج واجهة مضبوط الأنواع", () => {
    const result = parseInventoryReconciliationDiagnostic(payload);

    expect(result.status).toBe("rounding_only");
    expect(result.totals.cardQuantity).toBe(3880);
    expect(result.totals.movementToLedgerDifference).toBe(0.02);
    expect(result.rows[0]).toMatchObject({
      kind: "product",
      classification: "matched",
      brandName: "ماركة اختبار",
      modelNumber: "M-1",
      canPrepareRepair: false,
      wacToMovementDifference: -5,
    });
  });

  it("لا يحوّل فرق WAC التحليلي إلى مشكلة سلامة للمنتج", () => {
    const result = parseInventoryReconciliationDiagnostic(payload);
    const row = result.rows[0];

    expect(row.kind).toBe("product");
    expect(row.classification).toBe("matched");
    expect(result.totals.productIssueCount).toBe(0);
    expect(row.canPrepareRepair).toBe(false);
  });

  it("يرفض قسمًا غير معروف بدل عرض بيانات ملتبسة", () => {
    expect(() =>
      parseInventoryReconciliationDiagnostic({
        ...payload,
        page: { ...payload.page, section: "unknown" },
      }),
    ).toThrow("page.section");
  });

  it("يرفض رقمًا غير صالح في الإجماليات", () => {
    expect(() =>
      parseInventoryReconciliationDiagnostic({
        ...payload,
        totals: { ...payload.totals, movement_book_value: "not-a-number" },
      }),
    ).toThrow("totals.movement_book_value");
  });
});

describe("isReconciliationSnapshotStale", () => {
  it("يتعرف إلى رمز PostgreSQL ورسالة البصمة القديمة", () => {
    expect(isReconciliationSnapshotStale({ code: "40001" })).toBe(true);
    expect(
      isReconciliationSnapshotStale({ message: "RECONCILIATION_SNAPSHOT_STALE" }),
    ).toBe(true);
    expect(isReconciliationSnapshotStale(new Error("network"))).toBe(false);
  });
});

describe("inventory reconciliation source presentation", () => {
  const sourceRow: InventoryReconciliationSourceRow = {
    kind: "source",
    sourceKey: "purchase_invoice:7442f77c-23cd-45af-8a13-bcc202210f6b",
    sourceType: "purchase_invoice",
    sourceId: "7442f77c-23cd-45af-8a13-bcc202210f6b",
    sourceNumber: "24",
    sourceStatus: "posted",
    sourceDate: "2026-08-13",
    journalEntryId: "journal-1",
    reversalJournalEntryId: null,
    movementCount: 28,
    movementQuantity: 109,
    movementBookValue: 20759.99,
    ledger1104Value: 20760,
    sourceDifference: 0.01,
    classification: "rounding",
    reasonCodes: ["traceable_rounding_residual"],
    isRoundingOnly: true,
    canPrepareRepair: true,
  };

  it("يعرض رقم المستند ببادئة الشركة ولا يعرض UUID", () => {
    expect(formatInventorySourceNumber(sourceRow, { purchaseInvoice: "PUR-" })).toBe(
      "PUR-0024",
    );
  });

  it("ينشئ رابط المستند من النوع والمعرف الداخلي", () => {
    expect(getInventorySourcePath(sourceRow)).toBe(
      "/purchases/7442f77c-23cd-45af-8a13-bcc202210f6b",
    );
  });
});
