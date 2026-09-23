import assert from "node:assert/strict";
import test from "node:test";
import { applySql, explicitRollbackSql, validateApplied } from "./manage-inventory-tax-sales-acceptance-fixture.mjs";
import { fixture } from "./backup-inventory-tax-sales-acceptance-baseline.mjs";

test("التطبيق محدود بالحالة الجديدة ويستخدم التحقق المحاسبي قبل COMMIT", () => {
  assert.match(applySql, /^BEGIN;/);
  assert.match(applySql, /STAGING_TAX_SALES_ACCEPTANCE_PLAN_INVALID/);
  assert.match(applySql, new RegExp(fixture.invoiceId));
  assert.match(applySql, /COMMIT;\s*$/);
  assert.doesNotMatch(applySql, /\bROLLBACK\b/i);
  assert.doesNotMatch(applySql, /DO \$explicit_rollback\$/);
});

test("الرجوع يرفض الحالة بعد إنشاء معالجة ولا يغيّر إعداد الضريبة", () => {
  assert.match(explicitRollbackSql, /STAGING_TAX_SALES_ACCEPTANCE_ROLLBACK_REFUSED/);
  assert.match(explicitRollbackSql, /inventory_reconciliation_repair_items/);
  assert.match(explicitRollbackSql, /COMMIT;\s*$/);
  assert.doesNotMatch(explicitRollbackSql, /UPDATE public\.company_settings/);
});

test("فاحص التطبيق يرفض تغيّر حسابات أو إعدادات الشركة", () => {
  const counts = { accounts: 39, products: 616, inventory_movements: 1368,
    sales_invoices: 99, sales_invoice_items: 749, purchase_invoices: 33,
    journal_entries: 315, journal_entry_lines: 842, repairs: 6, repair_items: 6,
    repair_effects: 4, repair_events: 24 };
  const signatures = Object.fromEntries(["accounts", "settings", "purchase_invoices", "repairs", "repair_items", "repair_effects", "repair_events"].map((key) => [key, "unchanged"]));
  const before = { tax_settings: { tax_rate: 14 }, counts, signatures, diagnostic: { issue_counts: { sources: 2, products: 0 } } };
  const after = { database: "postgres", project_ref: "dunzfxurefzlaamgghys", server_version: "17.6",
    tax_settings: before.tax_settings,
    counts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value + ({ products: 1, inventory_movements: 2, sales_invoices: 1, sales_invoice_items: 1, journal_entries: 1, journal_entry_lines: 2 }[key] ?? 0)])),
    signatures, fixture_conflicts: { products: 1, invoices: 1, items: 1, movements: 2, repairs: 0 },
    diagnostic: { issue_counts: { sources: 3, products: 0 } } };
  assert.equal(validateApplied(after, before), after);
  assert.throws(() => validateApplied({ ...after, tax_settings: { tax_rate: 0 } }, before), /tax_settings/);
  assert.throws(() => validateApplied({ ...after, signatures: { ...after.signatures, accounts: "changed" } }, before), /signature_accounts/);
});
