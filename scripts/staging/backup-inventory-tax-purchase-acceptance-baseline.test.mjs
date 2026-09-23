import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptanceFixture,
  baselineSql,
  extractNamedPayload,
  validateBaseline,
} from "./backup-inventory-tax-purchase-acceptance-baseline.mjs";

const valid = {
  database: "postgres",
  server_version: "17.6",
  project_ref: "dunzfxurefzlaamgghys",
  migration_state: {
    system_accounts: true,
    planner: true,
    executor: true,
    ui_bridge: true,
    journal_numbering: true,
    configurable_tax: true,
    output_tax_account: true,
  },
  settings_count: 1,
  tax_settings: {
    enable_tax: false,
    tax_rate: 0,
    purchase_account: {
      code: "1105", name: "ضريبة القيمة المضافة للمدخلات", type: "asset",
      active: true, parent: false, system: true, parent_code: "11",
    },
    sales_account: {
      code: "2104", name: "ضريبة القيمة المضافة للمخرجات", type: "liability",
      active: true, parent: false, system: true, parent_code: "2",
    },
  },
  fixture_conflicts: { products: 0, invoices: 0, items: 0, movements: 0, repairs: 0 },
};

test("استعلام خط الأساس للقراءة فقط ومقيد بـStaging", () => {
  assert.match(baselineSql, /BEGIN TRANSACTION READ ONLY/);
  assert.match(baselineSql, /dunzfxurefzlaamgghys/);
  assert.match(baselineSql, /20260923100000/);
  assert.match(baselineSql, /20260923130000/);
  assert.match(baselineSql, new RegExp(acceptanceFixture.invoiceId));
  assert.doesNotMatch(baselineSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test("يستخرج خط الأساس المتداخل", () => {
  assert.deepEqual(extractNamedPayload([{ tax_purchase_acceptance_baseline: valid }], "tax_purchase_acceptance_baseline"), valid);
});

test("يقبل ربط 1105 و2104 ويرفض تفعيل الضريبة قبل النسخة", () => {
  assert.equal(validateBaseline(valid), valid);
  assert.throws(
    () => validateBaseline({ ...valid, tax_settings: { ...valid.tax_settings, enable_tax: true, tax_rate: 14 } }),
    /unexpected_tax_activation_state/,
  );
});

test("يرفض تعارض معرفات حالة القبول", () => {
  assert.throws(
    () => validateBaseline({ ...valid, fixture_conflicts: { ...valid.fixture_conflicts, invoices: 1 } }),
    /acceptance_fixture_conflict/,
  );
});
