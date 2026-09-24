import assert from "node:assert/strict";
import test from "node:test";
import { baselineSql, fixture, validateBaseline } from "./backup-inventory-purchase-return-cost-variance-baseline.mjs";

const valid = {
  database: "postgres", project_ref: "dunzfxurefzlaamgghys", server_version: "17.6",
  migration_state: { planner: true, executor: true, ui_bridge: true, numbering: true, tax_mapping: true, output_tax: true },
  settings_count: 1, tax_settings: { enable_tax: true, tax_rate: 14, purchase_code: "1105", sales_code: "2104" },
  source_invoice: { id: fixture.sourceInvoiceId, invoice_number: 990023, status: "posted",
    journal_status: "posted", journal_entry_id: "original", total: 114 },
  prior_return: { id: fixture.priorReturnId, return_number: 990026, status: "posted",
    journal_status: "posted", journal_entry_id: "prior" }, existing_source_returns: 1,
  source_product: { id: fixture.productId, code: "TST-TAX-PI-001", quantity: 1, purchase_price: 50 },
  source_movement: { quantity: 2, total_cost: 100 },
  fixture_conflicts: { returns: 0, items: 0, movements: 0, repairs: 0 },
};

test("خط الأساس الجديد قراءة فقط ويربط المرتجع السابق والفاتورة الأصلية", () => {
  assert.match(baselineSql, /^BEGIN TRANSACTION READ ONLY/);
  assert.match(baselineSql, new RegExp(fixture.returnId));
  assert.match(baselineSql, new RegExp(fixture.priorReturnId));
  assert.match(baselineSql, /return_number = 990027/);
  assert.doesNotMatch(baselineSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test("يوقف التجربة إذا لم تبق الوحدة المتوقعة أو تغير المرتجع السابق", () => {
  assert.equal(validateBaseline(valid), valid);
  assert.throws(() => validateBaseline({ ...valid, source_product: { ...valid.source_product,
    quantity: 0 } }), /source_inventory/);
  assert.throws(() => validateBaseline({ ...valid, prior_return: { ...valid.prior_return,
    status: "draft" } }), /prior_return/);
  assert.throws(() => validateBaseline({ ...valid, existing_source_returns: 2 }), /prior_return/);
});
