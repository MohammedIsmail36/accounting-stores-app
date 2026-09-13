import test from "node:test";
import assert from "node:assert/strict";
import { buildInventoryAdjustmentBaseline } from "./audit-inventory-adjustment-baseline.mjs";

const input = () => ({
  adjustments: [
    { id: "a1", status: "draft", journal_entry_id: null },
    { id: "a2", status: "approved", journal_entry_id: "j1" },
    { id: "a3", status: "cancelled", journal_entry_id: "j2" },
  ],
  items: [
    {
      id: "i1",
      adjustment_id: "a2",
      product_id: "p1",
      system_quantity: 10,
      actual_quantity: 8,
      difference: -2,
      unit_cost: 5,
      total_cost: 10,
    },
  ],
  movements: [
    { id: "m1", reference_id: "a2", reference_type: "adjustment" },
  ],
  journalEntries: [{ id: "j1" }, { id: "j2" }],
});

test("يبني خط أساس دون كشف بيانات المنتجات", () => {
  assert.deepEqual(buildInventoryAdjustmentBaseline(input()), {
    adjustments: 3,
    statuses: { approved: 1, cancelled: 1, draft: 1 },
    items: 1,
    adjustments_without_items: 2,
    orphan_items: 0,
    duplicate_products_within_document: 0,
    formula_mismatches: 0,
    linked_journals: 2,
    missing_linked_journals: 0,
    approved_without_expected_journal: 0,
    related_movements: 1,
    movement_reference_types: { adjustment: 1 },
    orphan_movement_references: 0,
    approved_documents_missing_movements: 0,
  });
});

test("يكشف العلاقات والحسابات غير المتطابقة دون اقتراح إصلاح", () => {
  const data = input();
  data.items.push({
    id: "i2",
    adjustment_id: "missing",
    product_id: "p1",
    system_quantity: 1,
    actual_quantity: 3,
    difference: 1,
    unit_cost: 4,
    total_cost: 99,
  });
  data.items.push({
    id: "i3",
    adjustment_id: "a2",
    product_id: "p1",
    system_quantity: 0,
    actual_quantity: 1,
    difference: 1,
    unit_cost: 5,
    total_cost: 5,
  });
  data.adjustments[1].journal_entry_id = "missing-journal";
  data.movements = [];

  const result = buildInventoryAdjustmentBaseline(data);
  assert.equal(result.orphan_items, 1);
  assert.equal(result.duplicate_products_within_document, 1);
  assert.equal(result.formula_mismatches, 1);
  assert.equal(result.missing_linked_journals, 1);
  assert.equal(result.approved_documents_missing_movements, 1);
});

test("يكشف التسوية المعتمدة ذات الصافي غير الصفري بلا قيد", () => {
  const data = input();
  data.adjustments[1].journal_entry_id = null;
  assert.equal(
    buildInventoryAdjustmentBaseline(data).approved_without_expected_journal,
    1,
  );
});
