import assert from "node:assert/strict";
import test from "node:test";
import { baselineSql, fixture, validateBaseline } from "./backup-inventory-adjustment-shortage-baseline.mjs";

const valid = {
  database: "postgres", project_ref: "dunzfxurefzlaamgghys", server_version: "17.6",
  migration_state: { system_accounts: true, planner: true, executor: true, ui_bridge: true, numbering: true },
  account_map: { "1104": { active: true, parent: false, system: true, type: "asset" },
    "5201": { active: true, parent: false, system: true, type: "expense", parent_code: "5" } },
  source_product: { id: fixture.productId, code: "TST-TAX-SI-001", quantity: 10, purchase_price: 40 },
  stock_movement: { signed_quantity: 10, signed_value: 400 },
  prior_sale: { id: fixture.saleInvoiceId, status: "posted", journal_status: "posted" },
  prior_return: { id: fixture.saleReturnId, status: "posted", journal_status: "posted" },
  fixture_conflicts: { adjustments: 0, items: 0, movements: 0, repairs: 0 },
};

test("نسخة العجز قراءة فقط ومقيدة بمستند وحركة منفصلين", () => {
  assert.match(baselineSql, /^BEGIN TRANSACTION READ ONLY/);
  assert.match(baselineSql, new RegExp(fixture.adjustmentId));
  assert.match(baselineSql, /public\.inventory_adjustment_items/);
  assert.doesNotMatch(baselineSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test("يرفض تغير حساب العجز أو رصيد المنتج أو المستندات السابقة", () => {
  assert.equal(validateBaseline(valid), valid);
  assert.throws(() => validateBaseline({ ...valid, account_map: { ...valid.account_map,
    "5201": { ...valid.account_map["5201"], system: false } } }), /account_map/);
  assert.throws(() => validateBaseline({ ...valid, source_product: { ...valid.source_product, quantity: 9 } }), /source_inventory/);
  assert.throws(() => validateBaseline({ ...valid, prior_return: { ...valid.prior_return, status: "draft" } }), /prior_documents/);
});
