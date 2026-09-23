import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBaselineMatches,
  buildRehearsalSql,
  buildRollbackSql,
} from "./rehearse-inventory-output-tax-system-account.mjs";

const baseline = {
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
  tax_settings: { id: "settings-id", enable_tax: false, tax_rate: 0, purchase_tax_account_id: null, sales_tax_account_id: null },
  counts: { accounts: 38 },
  signatures: { accounts: "a" },
  diagnostic: {
    snapshot_at: "2026-09-23T10:00:00Z",
    schema_version: 1,
    source_scope: "all_recorded_stock_effects",
    fingerprint: "fingerprint-a",
    status: "rounding_only",
    totals: { movement_to_ledger_difference: 0.02 },
    issue_counts: { rounding: 2 },
  },
};

test("يبني تجربة معاملاتية محمية تنتهي بالرجوع", () => {
  const sql = buildRehearsalSql("-- migration", baseline);
  assert.match(sql, /^BEGIN;/);
  assert.doesNotMatch(sql, /\\set\s+ON_ERROR_STOP/i);
  assert.match(sql, /STAGING_OUTPUT_TAX_TRANSACTIONAL_REHEARSAL_OK/);
  assert.match(sql, /STAGING_OUTPUT_TAX_IDEMPOTENCE_FAILED/);
  assert.match(sql, /ROLLBACK;/);
  assert.doesNotMatch(sql, /^\s*COMMIT\s*;/im);
});

test("يبني تجربة ملف الرجوع بتفويض صريح", () => {
  const sql = buildRollbackSql("-- migration", "-- rollback");
  assert.match(sql, /^BEGIN;/);
  assert.doesNotMatch(sql, /\\set\s+ON_ERROR_STOP/i);
  assert.match(sql, /STAGING_20260923130000/);
  assert.match(sql, /STAGING_OUTPUT_TAX_EXPLICIT_ROLLBACK_REHEARSAL_OK/);
  assert.match(sql, /ROLLBACK;/);
});

test("يطابق الخط المتوقع ويرفض تغير البصمات", () => {
  const sameWithNewSnapshot = structuredClone(baseline);
  sameWithNewSnapshot.diagnostic.snapshot_at = "2026-09-23T10:05:00Z";
  assert.doesNotThrow(() => assertBaselineMatches(baseline, sameWithNewSnapshot, "test"));
  const changed = structuredClone(baseline);
  changed.signatures.accounts = "changed";
  assert.throws(() => assertBaselineMatches(baseline, changed, "test"), /signatures/);
  const changedDiagnostic = structuredClone(baseline);
  changedDiagnostic.diagnostic.fingerprint = "fingerprint-b";
  assert.throws(() => assertBaselineMatches(baseline, changedDiagnostic, "test"), /diagnostic/);
});
