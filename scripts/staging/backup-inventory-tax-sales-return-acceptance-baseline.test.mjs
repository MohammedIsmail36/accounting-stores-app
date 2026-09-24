import assert from "node:assert/strict";
import test from "node:test";
import { baselineSql, extract, fixture, validateBaseline } from "./backup-inventory-tax-sales-return-acceptance-baseline.mjs";

const valid = {
  database: "postgres", project_ref: "dunzfxurefzlaamgghys", server_version: "17.6",
  migration_state: { planner: true, executor: true, ui_bridge: true, numbering: true, tax_mapping: true, output_tax: true },
  settings_count: 1,
  tax_settings: { enable_tax: true, tax_rate: 14, purchase_code: "1105", sales_code: "2104",
    sales_system: true, sales_active: true, sales_parent: false },
  source_invoice: { id: fixture.sourceInvoiceId, invoice_number: 990024, status: "posted",
    journal_status: "posted", journal_entry_id: "journal", tax: 14, total: 114 },
  source_product: { id: fixture.productId, code: "TST-TAX-SI-001", quantity: 8, purchase_price: 40 },
  fixture_conflicts: { returns: 0, items: 0, movements: 0, repairs: 0 },
};

test("خط الأساس قراءة فقط ويرصد حالة مرتجع البيع المقيد بـStaging", () => {
  assert.match(baselineSql, /^BEGIN TRANSACTION READ ONLY/);
  assert.match(baselineSql, /public\.sales_returns/);
  assert.match(baselineSql, /public\.sales_return_items/);
  assert.match(baselineSql, new RegExp(fixture.returnId));
  assert.doesNotMatch(baselineSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test("يفحص فاتورة البيع المرجعية والضريبة ويرفض التعارض", () => {
  assert.equal(validateBaseline(valid), valid);
  assert.deepEqual(extract([{ sales_return_acceptance_baseline: valid }], "sales_return_acceptance_baseline"), valid);
  assert.throws(() => validateBaseline({ ...valid, source_product: { ...valid.source_product, quantity: 10 } }), /source_product/);
  assert.throws(() => validateBaseline({ ...valid, tax_settings: { ...valid.tax_settings, sales_code: "2102" } }), /tax_settings/);
  assert.throws(() => validateBaseline({ ...valid, fixture_conflicts: { ...valid.fixture_conflicts, returns: 1 } }), /fixture_conflicts/);
});
