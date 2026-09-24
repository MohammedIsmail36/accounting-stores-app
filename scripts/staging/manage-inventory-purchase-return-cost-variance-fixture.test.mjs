import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./backup-inventory-purchase-return-cost-variance-baseline.mjs";
import { applySql, explicitRollbackSql } from "./manage-inventory-purchase-return-cost-variance-fixture.mjs";

test("الإعداد ينشئ المرتجع الجديد وحده بعد التحقق من خطة 5108", () => {
  assert.match(applySql, /^BEGIN;/);
  assert.match(applySql, /COMMIT;\s*$/);
  assert.match(applySql, new RegExp(fixture.returnId));
  assert.match(applySql, /STAGING_PURCHASE_RETURN_VARIANCE_PLAN_INVALID/);
  assert.doesNotMatch(applySql, /DO \$explicit_rollback\$/);
});

test("الرجوع يرفض حذف مرتجع بعد ربط قيد أو معالجة", () => {
  assert.match(explicitRollbackSql, /STAGING_PURCHASE_RETURN_VARIANCE_ROLLBACK_REFUSED/);
  assert.match(explicitRollbackSql, /journal_entry_id IS NULL/);
  assert.match(explicitRollbackSql, /inventory_reconciliation_repair_items/);
  assert.match(explicitRollbackSql, /COMMIT;\s*$/);
});
