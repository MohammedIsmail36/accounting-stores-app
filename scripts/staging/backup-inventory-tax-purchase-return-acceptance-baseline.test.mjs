import assert from "node:assert/strict";
import test from "node:test";
import { baselineSql, extract, fixture, validateBaseline } from "./backup-inventory-tax-purchase-return-acceptance-baseline.mjs";

const valid = {
  database: "postgres", project_ref: "dunzfxurefzlaamgghys", server_version: "17.6",
  migration_state: { planner: true, executor: true, ui_bridge: true, numbering: true, tax_mapping: true, output_tax: true },
  settings_count: 1,
  tax_settings: { enable_tax: true, tax_rate: 14, purchase_code: "1105", sales_code: "2104",
    purchase_system: true, purchase_active: true, purchase_parent: false },
  source_invoice: { id: fixture.sourceInvoiceId, invoice_number: 990023, status: "posted",
    journal_status: "posted", journal_entry_id: "journal", subtotal: 100, tax: 14, total: 114 },
  source_product: { id: fixture.productId, code: "TST-TAX-PI-001", quantity: 2, purchase_price: 50 },
  source_movement: { quantity: 2, total_cost: 100 }, existing_source_returns: 0,
  fixture_conflicts: { returns: 0, items: 0, movements: 0, repairs: 0 },
};

test("نسخة مرتجع الشراء قراءة فقط ومقيدة ببيئة Staging", () => {
  assert.match(baselineSql, /^BEGIN TRANSACTION READ ONLY/);
  assert.match(baselineSql, new RegExp(fixture.returnId));
  assert.match(baselineSql, /public\.purchase_return_items/);
  assert.doesNotMatch(baselineSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test("يرفض خط الأساس إن تغيرت الفاتورة أو الضريبة أو المنتج أو هوية الحالة", () => {
  assert.equal(validateBaseline(valid), valid);
  assert.deepEqual(extract([{ purchase_return_acceptance_baseline: valid }], "purchase_return_acceptance_baseline"), valid);
  assert.throws(() => validateBaseline({ ...valid, source_invoice: { ...valid.source_invoice, status: "draft" } }), /source_invoice/);
  assert.throws(() => validateBaseline({ ...valid, tax_settings: { ...valid.tax_settings, purchase_code: "1106" } }), /tax_settings/);
  assert.throws(() => validateBaseline({ ...valid, source_product: { ...valid.source_product, quantity: 1 } }), /source_inventory/);
  assert.throws(() => validateBaseline({ ...valid, fixture_conflicts: { ...valid.fixture_conflicts, returns: 1 } }), /fixture_conflicts/);
});
