import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./backup-inventory-adjustment-surplus-baseline.mjs";
import { applySql, explicitRollbackSql, validateApplied } from "./manage-inventory-adjustment-surplus-fixture.mjs";

test("الإعداد ينشئ تسوية الفائض وحركتها فقط بعد فحص الخطة", () => {
  assert.match(applySql, /^BEGIN;/);
  assert.match(applySql, /COMMIT;\s*$/);
  assert.match(applySql, new RegExp(fixture.adjustmentId));
  assert.match(applySql, /STAGING_ADJUSTMENT_SURPLUS_PLAN_INVALID/);
  assert.doesNotMatch(applySql, /DO \$explicit_rollback\$/);
});

test("الرجوع يرفض حذف التسوية بعد ربط قيد أو معالجة", () => {
  assert.match(explicitRollbackSql, /STAGING_ADJUSTMENT_SURPLUS_ROLLBACK_REFUSED/);
  assert.match(explicitRollbackSql, /journal_entry_id IS NULL/);
  assert.match(explicitRollbackSql, /inventory_reconciliation_repair_items/);
  assert.match(explicitRollbackSql, /COMMIT;\s*$/);
});

test("يرفض إعدادًا لا يطابق كمية وقيمة الحركة أو أعداد الجداول", () => {
  const expected = { database: "postgres", project_ref: "dunzfxurefzlaamgghys", server_version: "17.6",
    account_map: {}, prior_shortage: {}, prior_sale: {}, prior_return: {},
    source_product: { id: fixture.productId, quantity: 9, purchase_price: 40 },
    stock_movement: { signed_quantity: 9, signed_value: 360 },
    counts: { accounts: 1 }, signatures: {}, diagnostic: { issue_counts: { sources: 0, products: 0 } } };
  assert.throws(() => validateApplied({ ...expected, source_product: { ...expected.source_product, quantity: 8 } }, expected), /product_and_movements/);
});
