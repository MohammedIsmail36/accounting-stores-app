import assert from "node:assert/strict";
import test from "node:test";
import {
  extractNamedPayload,
  inspectionSql,
  validateInspection,
} from "./inspect-inventory-tax-account-candidates.mjs";

const valid = {
  database: "postgres",
  server_version: "17.6",
  project_ref: "dunzfxurefzlaamgghys",
  migration_present: true,
  guards: { settings_validator: true, account_guard: true },
  settings_count: 1,
  settings: { enable_tax: false },
  purchase_candidates: [],
  sales_candidates: [],
  rejected_tax_like_accounts: [],
};

test("الاستعلام للقراءة فقط ويقيد هوية Staging", () => {
  assert.match(inspectionSql, /BEGIN TRANSACTION READ ONLY/);
  assert.match(inspectionSql, /20260923100000/);
  assert.match(inspectionSql, /dunzfxurefzlaamgghys/);
  assert.doesNotMatch(inspectionSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});
test("يستخرج حمولة Supabase المتداخلة", () => {
  assert.deepEqual(
    extractNamedPayload([{ tax_account_inspection: valid }], "tax_account_inspection"),
    valid,
  );
});

test("يقبل تقرير Staging الآمن ويرفض غياب الحراس", () => {
  assert.equal(validateInspection(valid), valid);
  assert.throws(
    () => validateInspection({ ...valid, guards: { ...valid.guards, account_guard: false } }),
    /tax_guards_missing/,
  );
});
