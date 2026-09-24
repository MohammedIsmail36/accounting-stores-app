import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./backup-inventory-tax-purchase-return-acceptance-baseline.mjs";
import { applySql, explicitRollbackSql, validateApplied } from "./manage-inventory-tax-purchase-return-acceptance-fixture.mjs";

test("الإعداد يكتب مرتجع الشراء وحده بعد حارس الهوية والخطة", () => {
  assert.match(applySql, /^BEGIN;/);
  assert.match(applySql, /COMMIT;\s*$/);
  assert.match(applySql, new RegExp(fixture.returnId));
  assert.match(applySql, /STAGING_TAX_PURCHASE_RETURN_PLAN_INVALID/);
  assert.doesNotMatch(applySql, /DO \$explicit_rollback\$/);
});

test("الرجوع الصريح يرفض حذف مرتجع له معالجة أو قيد", () => {
  assert.match(explicitRollbackSql, /STAGING_TAX_PURCHASE_RETURN_ROLLBACK_REFUSED/);
  assert.match(explicitRollbackSql, /journal_entry_id IS NULL/);
  assert.match(explicitRollbackSql, /inventory_reconciliation_repair_items/);
  assert.match(explicitRollbackSql, /COMMIT;\s*$/);
});

test("التحقق بعد الإعداد يرفض تغير فاتورة الشراء المرجعية", () => {
  const baseline = { counts: { accounts: 1, settings: 1, products: 1, inventory_movements: 1,
    sales_invoices: 1, sales_returns: 1, purchase_invoices: 1, purchase_returns: 1,
    purchase_return_items: 1, journal_entries: 1, journal_entry_lines: 1,
    repairs: 1, repair_items: 1, repair_effects: 1, repair_events: 1 },
  tax_settings: { tax_rate: 14 }, source_invoice: { id: fixture.sourceInvoiceId },
  signatures: {}, diagnostic: { issue_counts: { sources: 0, products: 0 } } };
  const actual = { ...baseline, database: "postgres", project_ref: "dunzfxurefzlaamgghys", server_version: "17.6",
    source_invoice: { id: "wrong" }, source_product: { id: fixture.productId, quantity: 1, purchase_price: 50 },
    existing_source_returns: 1, fixture_conflicts: { returns: 1, items: 1, movements: 1, repairs: 0 },
    counts: { ...baseline.counts, inventory_movements: 2, purchase_returns: 2, purchase_return_items: 2 },
    diagnostic: { issue_counts: { sources: 1, products: 0 } } };
  assert.throws(() => validateApplied(actual, baseline), /source_or_settings/);
});
