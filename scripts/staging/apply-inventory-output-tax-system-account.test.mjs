import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  outputTaxVerificationSql,
  validateApplySource,
  validateOutputTaxState,
  validatePostApplyBusiness,
} from "./apply-inventory-output-tax-system-account.mjs";

const source = readFileSync(fileURLToPath(new URL(
  "./apply-inventory-output-tax-system-account.mjs", import.meta.url,
)), "utf8");

const account = (code, overrides = {}) => ({
  id: `${code}-id`, code, name: code === "1105" ? "ضريبة القيمة المضافة للمدخلات" : "حساب",
  type: code === "1105" ? "asset" : "liability", active: true, parent: false,
  system: true, parent_code: code === "1105" ? "11" : "2", journal_lines: 0, ...overrides,
});

const before = {
  migration_state: { configurable_tax: true, output_tax_account: false },
  settings_count: 1,
  tax_accounts: [account("1105"), account("2102"), account("2103")],
  tax_settings: {
    id: "settings-id", enable_tax: false, tax_rate: 0,
    purchase_tax_account_id: null, sales_tax_account_id: null,
  },
  counts: { accounts: 38, products: 2, journal_entries: 3 },
  signatures: { accounts: "before", company_settings: "before", products: "same", journal_entries: "same" },
  diagnostic: {
    snapshot_at: "first", schema_version: 1, source_scope: "all_recorded_stock_effects",
    fingerprint: "same", status: "rounding_only", totals: { difference: 0.02 }, issue_counts: { rounding: 2 },
  },
};

test("مشغل التطبيق محصور في Staging ويشترط النسخة والتجربة والفحص الجاف", () => {
  assert.doesNotThrow(() => validateApplySource(source));
  for (const required of ["migration-dry-run", "migration-apply", "pre-apply-verification",
    "post-apply-business-verification", "post-apply-schema-verification"]) {
    assert.ok(source.includes(required), `حاجز مفقود: ${required}`);
  }
});

test("مقارنة ما بعد التطبيق تسمح فقط بالحساب والربط المقصودين", () => {
  const after = structuredClone(before);
  const output = account("2104", { name: "ضريبة القيمة المضافة للمخرجات" });
  after.tax_accounts.push(output);
  after.counts.accounts = 39;
  after.signatures.accounts = "after";
  after.signatures.company_settings = "after";
  after.migration_state.output_tax_account = true;
  after.tax_settings.purchase_tax_account_id = "1105-id";
  after.tax_settings.sales_tax_account_id = "2104-id";
  after.diagnostic.snapshot_at = "second";
  assert.doesNotThrow(() => validatePostApplyBusiness(before, after));
  after.signatures.products = "changed";
  assert.throws(() => validatePostApplyBusiness(before, after), /غير مطابقة/);
});

test("فحص المخطط يثبت هوية 2104 وحمايته وبقاء حسابات القروض", () => {
  const state = {
    database: "postgres", project_ref: "dunzfxurefzlaamgghys", migration_present: true,
    output_tax: {
      code: "2104", name: "ضريبة القيمة المضافة للمخرجات", type: "liability",
      active: true, parent: false, system: true, parent_code: "2",
      description: "SYSTEM:OUTPUT_VAT:20260923130000", journal_lines: 0, children: 0, expense_types: 0,
    },
    loan_accounts: [
      { code: "2102", name: "قروض قصيرة الأجل" },
      { code: "2103", name: "قروض طويلة الأجل" },
    ],
    guards: {
      system_delete_function: true, configured_shape_function: true,
      system_delete_trigger: 1, configured_shape_trigger: 1,
    },
    comments: { purchase: "defaults to protected account 1105", sales: "defaults to protected account 2104" },
  };
  assert.doesNotThrow(() => validateOutputTaxState(state));
  assert.match(outputTaxVerificationSql, /^BEGIN TRANSACTION READ ONLY;/);
  assert.match(outputTaxVerificationSql, /ROLLBACK;/);
  assert.doesNotMatch(outputTaxVerificationSql, /\b(?:INSERT|UPDATE|DELETE|COMMIT)\b/i);
});
