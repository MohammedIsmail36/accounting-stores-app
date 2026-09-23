import assert from "node:assert/strict";
import test from "node:test";
import {
  auditSql,
  extractNamedPayload,
  validateAudit,
} from "./audit-inventory-sales-tax-account-conflict.mjs";

const valid = {
  database: "postgres",
  server_version: "17.6",
  project_ref: "dunzfxurefzlaamgghys",
  migration_present: true,
  target_2102_count: 1,
  target_2102: { code: "2102", name: "قروض قصيرة الأجل" },
  target_2102_usage: { journal_lines: 0 },
  liability_21xx: [],
  code_availability: { "2104": true },
  referencing_foreign_keys: [],
};

test("التدقيق للقراءة فقط ويشمل الاعتمادات والرموز البديلة", () => {
  assert.match(auditSql, /BEGIN TRANSACTION READ ONLY/);
  assert.match(auditSql, /expense_types/);
  assert.match(auditSql, /referencing_foreign_keys/);
  assert.match(auditSql, /'2104'/);
  assert.doesNotMatch(auditSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});
test("يستخرج التقرير المتداخل", () => {
  assert.deepEqual(extractNamedPayload([{ sales_tax_account_audit: valid }], "sales_tax_account_audit"), valid);
});

test("يقبل تقرير Staging المتوقع ويرفض هوية 2102 الملتبسة", () => {
  assert.equal(validateAudit(valid), valid);
  assert.throws(() => validateAudit({ ...valid, target_2102_count: 2 }), /target_2102_identity/);
});
