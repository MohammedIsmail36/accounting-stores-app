import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  baselineSql,
  extractNamedPayload,
  validateBaseline,
} from "./backup-inventory-configurable-tax-accounts-baseline.mjs";

const source = readFileSync(fileURLToPath(new URL(
  "./backup-inventory-configurable-tax-accounts-baseline.mjs", import.meta.url,
)), "utf8");

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
    configurable_tax: false,
  },
  function_state: {
    public_planner: true,
    base_planner: true,
    fixed_tax_legacy: false,
    settings_validator: false,
    account_guard: false,
    base_contains_1105: true,
    base_contains_2102: true,
  },
  trigger_state: { settings_validator: false, account_guard: false },
  tax_settings: {
    enable_tax: true,
    purchase_account: { type: "asset", active: true, parent: false },
    sales_account: { type: "liability", active: true, parent: false },
  },
};

test("نسخة حسابات الضريبة مقيدة بـStaging والقراءة فقط", () => {
  for (const required of [
    "dunzfxurefzlaamgghys",
    "BEGIN TRANSACTION READ ONLY;",
    "20260923100000",
    "purchase_account",
    "sales_account",
    "productionModified: false",
  ]) assert.ok(`${source}\n${baselineSql}`.includes(required), `حاجز مفقود: ${required}`);
  for (const forbidden of [
    ["farida", "-db"].join(""),
    ["alibea", "-db"].join(""),
    ["farida", ".alibea2020.com"].join(""),
    ["alibea", ".alibea2020.com"].join(""),
  ]) assert.equal(source.includes(forbidden), false, `وجهة إنتاجية ممنوعة: ${forbidden}`);
});

test("يقبل الحسابين الدلاليين ويرفض النوع أو المرحلة غير الآمنة", () => {
  assert.doesNotThrow(() => validateBaseline(valid));
  assert.throws(() => validateBaseline({
    ...valid,
    migration_state: { ...valid.migration_state, configurable_tax: true },
  }), /migration_already_present/);
  assert.throws(() => validateBaseline({
    ...valid,
    tax_settings: {
      ...valid.tax_settings,
      purchase_account: { type: "liability", active: true, parent: false },
    },
  }), /purchase_tax_account_invalid/);
});

test("يستخرج baseline من تغليف Supabase المتداخل", () => {
  assert.deepEqual(
    extractNamedPayload({ rows: [{ baseline: valid }] }, "baseline"),
    valid,
  );
});
