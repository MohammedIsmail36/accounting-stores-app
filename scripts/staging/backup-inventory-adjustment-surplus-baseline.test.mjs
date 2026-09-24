import assert from "node:assert/strict";
import test from "node:test";
import { baselineSql, fixture, validateBaseline } from "./backup-inventory-adjustment-surplus-baseline.mjs";

const valid = {
  database: "postgres", project_ref: "dunzfxurefzlaamgghys", server_version: "17.6",
  migration_state: { system_accounts: true, planner: true, executor: true, ui_bridge: true, numbering: true },
  account_map: { "1104": { active: true, parent: false, system: true, type: "asset" },
    "4201": { active: true, parent: false, system: true, type: "revenue", parent_code: "4" } },
  source_product: { id: fixture.productId, code: "TST-TAX-SI-001", quantity: 9, purchase_price: 40 },
  stock_movement: { signed_quantity: 9, signed_value: 360 },
  prior_shortage: { id: fixture.priorShortageId, adjustment_number: 990028, status: "posted",
    journal_status: "posted", journal_posted_number: 321 },
  fixture_conflicts: { adjustments: 0, items: 0, movements: 0, repairs: 0 },
};

test("نسخة الفائض قراءة فقط ومستقلة عن حالة العجز", () => {
  assert.match(baselineSql, /^BEGIN TRANSACTION READ ONLY/);
  assert.match(baselineSql, new RegExp(fixture.adjustmentId));
  assert.match(baselineSql, new RegExp(fixture.priorShortageId));
  assert.match(baselineSql, /adjustment_surplus_baseline/);
  assert.doesNotMatch(baselineSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test("يرفض تغير حساب الفائض أو الرصيد أو قيد العجز السابق", () => {
  assert.equal(validateBaseline(valid), valid);
  assert.throws(() => validateBaseline({ ...valid, account_map: { ...valid.account_map,
    "4201": { ...valid.account_map["4201"], system: false } } }), /account_map/);
  assert.throws(() => validateBaseline({ ...valid, source_product: { ...valid.source_product, quantity: 10 } }), /source_inventory/);
  assert.throws(() => validateBaseline({ ...valid, prior_shortage: { ...valid.prior_shortage,
    journal_status: "draft" } }), /prior_shortage/);
});
