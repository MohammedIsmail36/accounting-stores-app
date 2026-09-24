import assert from "node:assert/strict";
import test from "node:test";
import { applySql, explicitRollbackSql, validateApplied, validateBusinessRollback } from "./manage-inventory-tax-sales-return-acceptance-fixture.mjs";
import { fixture } from "./backup-inventory-tax-sales-return-acceptance-baseline.mjs";

test("الإعداد يتحقق من الخطة قبل COMMIT ولا ينفذ الرجوع", () => {
  assert.match(applySql, /^BEGIN;/);
  assert.match(applySql, /STAGING_TAX_SALES_RETURN_PLAN_INVALID/);
  assert.match(applySql, new RegExp(fixture.returnId));
  assert.match(applySql, /COMMIT;\s*$/);
  assert.doesNotMatch(applySql, /DO \$explicit_rollback\$/);
  assert.doesNotMatch(applySql, /\bROLLBACK\b/i);
});

test("ملف الرجوع يرفض وجود معالجة ويحفظ الفاتورة الأصلية", () => {
  assert.match(explicitRollbackSql, /STAGING_TAX_SALES_RETURN_ROLLBACK_REFUSED/);
  assert.match(explicitRollbackSql, /inventory_reconciliation_repair_items/);
  assert.match(explicitRollbackSql, /quantity_on_hand = 8/);
  assert.doesNotMatch(explicitRollbackSql, /DELETE FROM public\.sales_invoices/);
  assert.match(explicitRollbackSql, /COMMIT;\s*$/);
});

test("الفاحص يرفض تغير الإعدادات أو رصيد بطاقة المنتج", () => {
  const counts = { accounts: 39, products: 617, inventory_movements: 1370,
    sales_invoices: 100, sales_returns: 10, sales_return_items: 16,
    purchase_invoices: 33, purchase_returns: 5, journal_entries: 317,
    journal_entry_lines: 849, repairs: 7, repair_items: 7, repair_effects: 5, repair_events: 28 };
  const signatures = Object.fromEntries(["accounts", "settings", "sales_invoices", "sales_returns", "sales_return_items",
    "inventory_movements", "purchase_invoices", "purchase_returns", "journal_entries", "journal_entry_lines",
    "repairs", "repair_items", "repair_effects", "repair_events"].map((key) => [key, "original"]));
  const before = { counts, signatures, tax_settings: { tax_rate: 14 }, source_invoice: { id: fixture.sourceInvoiceId },
    diagnostic: { issue_counts: { sources: 2, products: 0 } } };
  const applied = { database: "postgres", project_ref: "dunzfxurefzlaamgghys", server_version: "17.6",
    counts: { ...counts, inventory_movements: 1371, sales_returns: 11, sales_return_items: 17 },
    signatures, tax_settings: before.tax_settings, source_invoice: before.source_invoice,
    source_product: { id: fixture.productId, quantity: 10, purchase_price: 40 },
    fixture_conflicts: { returns: 1, items: 1, movements: 1, repairs: 0 },
    diagnostic: { issue_counts: { sources: 3, products: 0 } } };
  assert.equal(validateApplied(applied, before), applied);
  assert.throws(() => validateApplied({ ...applied, source_product: { ...applied.source_product, quantity: 8 } }, before), /product_quantity/);
  assert.throws(() => validateApplied({ ...applied, tax_settings: { tax_rate: 0 } }, before), /source_or_settings/);
  const rolledBack = { ...applied, counts, fixture_conflicts: { returns: 0, items: 0, movements: 0, repairs: 0 },
    source_product: { ...applied.source_product, quantity: 8 }, diagnostic: before.diagnostic };
  assert.equal(validateBusinessRollback(rolledBack, before), rolledBack);
});
