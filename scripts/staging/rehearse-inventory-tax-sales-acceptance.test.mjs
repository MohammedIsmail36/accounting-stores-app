import assert from "node:assert/strict";
import test from "node:test";
import { rehearsalSql } from "./rehearse-inventory-tax-sales-acceptance.mjs";
import { fixture } from "./backup-inventory-tax-sales-acceptance-baseline.mjs";

test("التجربة معاملاتية على Staging ولا تحوي COMMIT", () => {
  assert.match(rehearsalSql, /^BEGIN;/);
  assert.match(rehearsalSql, /ROLLBACK;\s*$/);
  assert.doesNotMatch(rehearsalSql, /\bCOMMIT\b/i);
  assert.match(rehearsalSql, /current_database\(\) <> 'postgres'/);
  assert.match(rehearsalSql, /server_version.*17/);
  assert.match(rehearsalSql, /tax_rate = 14/);
  assert.match(rehearsalSql, /a\.code = '2104'/);
});

test("الخطة تختبر ضريبة المخرجات والحسابات الخمسة ومطابقة الرصيد", () => {
  assert.match(rehearsalSql, new RegExp(fixture.invoiceId));
  assert.match(rehearsalSql, /v_debit <> 194 OR v_credit <> 194/);
  for (const code of ["1103", "4101", "2104", "5101", "1104"]) {
    assert.match(rehearsalSql, new RegExp(`account_code' = '${code}'`));
  }
  assert.match(rehearsalSql, /movement_without_journal/);
  assert.match(rehearsalSql, /v_opening->>'classification' <> 'matched'/);
  assert.match(rehearsalSql, /STAGING_TAX_SALES_ACCEPTANCE_ROLLBACK_POSTCHECK_FAILED/);
});
