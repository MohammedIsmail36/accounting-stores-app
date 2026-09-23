import assert from "node:assert/strict";
import test from "node:test";
import { baselineSql, extract, fixture, validateBaseline } from "./backup-inventory-tax-sales-acceptance-baseline.mjs";

const valid = {
  database: "postgres", project_ref: "dunzfxurefzlaamgghys", server_version: "17.6",
  migration_state: { planner: true, executor: true, ui_bridge: true, numbering: true, tax_mapping: true, output_tax: true },
  settings_count: 1,
  tax_settings: { enable_tax: true, tax_rate: 14, purchase_code: "1105", purchase_system: true,
    sales_code: "2104", sales_system: true, sales_type: "liability", sales_active: true, sales_parent: false },
  fixture_conflicts: { products: 0, invoices: 0, items: 0, movements: 0, repairs: 0 },
};

test("خط الأساس قراءة فقط ومربوط بحالة بيع جديدة على Staging", () => {
  assert.match(baselineSql, /BEGIN TRANSACTION READ ONLY/);
  assert.match(baselineSql, /public\.sales_invoices/);
  assert.match(baselineSql, /public\.sales_invoice_items/);
  assert.match(baselineSql, new RegExp(fixture.invoiceId));
  assert.match(baselineSql, /dunzfxurefzlaamgghys/);
  assert.doesNotMatch(baselineSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test("استخراج نتيجة Supabase المتداخلة", () => {
  assert.deepEqual(extract([{ tax_sales_acceptance_baseline: valid }], "tax_sales_acceptance_baseline"), valid);
});

test("يتطلب تفعيل 14% وربط 1105 و2104 الصحيحين", () => {
  assert.equal(validateBaseline(valid), valid);
  assert.throws(() => validateBaseline({ ...valid, tax_settings: { ...valid.tax_settings, enable_tax: false } }), /tax_settings/);
  assert.throws(() => validateBaseline({ ...valid, tax_settings: { ...valid.tax_settings, sales_code: "2102" } }), /tax_settings/);
  assert.throws(() => validateBaseline({ ...valid, migration_state: { ...valid.migration_state, output_tax: false } }), /migrations/);
});

test("يرفض تعارض معرفات الحالة", () => {
  assert.throws(() => validateBaseline({ ...valid, fixture_conflicts: { ...valid.fixture_conflicts, invoices: 1 } }), /fixture_conflicts/);
});
