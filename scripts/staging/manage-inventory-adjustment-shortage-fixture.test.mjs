import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./backup-inventory-adjustment-shortage-baseline.mjs";
import { applySql, explicitRollbackSql, validateApplied } from "./manage-inventory-adjustment-shortage-fixture.mjs";

test("الإعداد ينشئ التسوية وحركة عجز فقط بعد فحص الخطة", () => {
  assert.match(applySql, /^BEGIN;/);
  assert.match(applySql, /COMMIT;\s*$/);
  assert.match(applySql, new RegExp(fixture.adjustmentId));
  assert.match(applySql, /STAGING_ADJUSTMENT_SHORTAGE_PLAN_INVALID/);
  assert.doesNotMatch(applySql, /DO \$explicit_rollback\$/);
});

test("الرجوع يرفض حذف التسوية بعد ربط قيد أو معالجة", () => {
  assert.match(explicitRollbackSql, /STAGING_ADJUSTMENT_SHORTAGE_ROLLBACK_REFUSED/);
  assert.match(explicitRollbackSql, /journal_entry_id IS NULL/);
  assert.match(explicitRollbackSql, /inventory_reconciliation_repair_items/);
  assert.match(explicitRollbackSql, /COMMIT;\s*$/);
});

test("يرفض إعدادًا لا يطابق كمية وقيمة الحركة أو أعداد الجداول", () => {
  const expected = { database: "postgres", project_ref: "dunzfxurefzlaamgghys", server_version: "17.6",
    account_map: {}, prior_sale: {}, prior_return: {},
    source_product: { id: fixture.productId, quantity: 10, purchase_price: 40 },
    stock_movement: { signed_quantity: 10, signed_value: 400 },
    counts: { accounts: 1 }, signatures: {}, diagnostic: { issue_counts: { sources: 0, products: 0 } } };
  assert.throws(() => validateApplied({ ...expected, source_product: { ...expected.source_product, quantity: 8 } }, expected), /product_and_movements/);
});
