import assert from "node:assert/strict";
import test from "node:test";
import {
  baselineSql,
  extractNamedPayload,
  validateBaseline,
} from "./backup-inventory-output-tax-system-account-baseline.mjs";

const valid = {
  database: "postgres",
  server_version: "17.6",
  project_ref: "dunzfxurefzlaamgghys",
  migration_state: { configurable_tax: true, output_tax_account: false },
  settings_count: 1,
  tax_accounts: [
    { code: "1105", name: "ضريبة القيمة المضافة للمدخلات", type: "asset", active: true, parent: false, system: true, parent_code: "11" },
    { code: "2102", name: "قروض قصيرة الأجل", type: "liability" },
    { code: "2103", name: "قروض طويلة الأجل", type: "liability" },
  ],
  tax_settings: {
    enable_tax: false,
    tax_rate: 0,
    purchase_tax_account_id: null,
    sales_tax_account_id: null,
  },
};

test("استعلام النسخة للقراءة فقط ويثبت هوية Staging", () => {
  assert.match(baselineSql, /BEGIN TRANSACTION READ ONLY/);
  assert.match(baselineSql, /20260923130000/);
  assert.match(baselineSql, /dunzfxurefzlaamgghys/);
  assert.doesNotMatch(baselineSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test("يستخرج خط الأساس المتداخل", () => {
  assert.deepEqual(extractNamedPayload([{ output_tax_baseline: valid }], "output_tax_baseline"), valid);
});

test("يقبل الخط الآمن ويرفض وجود 2104 مسبقًا", () => {
  assert.equal(validateBaseline(valid), valid);
  assert.throws(
    () => validateBaseline({ ...valid, tax_accounts: [...valid.tax_accounts, { code: "2104" }] }),
    /output_tax_account_already_present/,
  );
});
