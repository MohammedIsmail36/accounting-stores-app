import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  sameBusinessState,
  schemaVerificationSql,
  validateApplySource,
} from "./apply-inventory-configurable-tax-accounts.mjs";

const source = readFileSync(fileURLToPath(new URL(
  "./apply-inventory-configurable-tax-accounts.mjs", import.meta.url,
)), "utf8");

test("التطبيق محصور في Staging ويشترط النسخة والتجربة والفحص الجاف", () => {
  assert.doesNotThrow(() => validateApplySource(source));
  for (const required of [
    "migration-dry-run",
    "migration-apply",
    "pre-apply-verification",
    "post-apply-business-verification",
    "post-apply-schema-verification",
  ]) assert.ok(source.includes(required), `حاجز مفقود: ${required}`);
});

test("التحقق اللاحق يثبت الدوال والحارسين والصلاحيات", () => {
  for (const required of [
    "BEGIN TRANSACTION READ ONLY;",
    "fn_validate_company_tax_account_mapping",
    "fn_guard_configured_tax_account_shape",
    "base_security_definer",
    "base_authenticated_execute",
    "settings_validator_count",
    "account_guard_count",
    "ROLLBACK;",
  ]) assert.ok(schemaVerificationSql.includes(required), `فحص مفقود: ${required}`);
});

test("مقارنة الأعمال تتجاهل تغير المخطط ولا تتجاهل تغير البيانات", () => {
  const baseline = {
    database: "postgres",
    server_version: "17.6",
    project_ref: "dunzfxurefzlaamgghys",
    tax_settings: { enable_tax: false },
    counts: { products: 1 },
    signatures: { products: "same" },
    diagnostic: { status: "matched", generated_at: "first" },
    function_state: { base_planner: false },
  };
  assert.equal(sameBusinessState({
    ...baseline,
    diagnostic: { ...baseline.diagnostic, generated_at: "second" },
    function_state: { base_planner: true },
  }, baseline), true);
  assert.equal(sameBusinessState({ ...baseline, counts: { products: 2 } }, baseline), false);
});
