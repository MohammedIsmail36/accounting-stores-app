import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./backup-inventory-tax-sales-return-acceptance-baseline.mjs";
import { rehearsalSql } from "./rehearse-inventory-tax-sales-return-acceptance.mjs";

test("تجربة المرتجع معاملاتية ولا تحفظ حالة دائمة", () => {
  assert.match(rehearsalSql, /^BEGIN;/);
  assert.match(rehearsalSql, /ROLLBACK;\s*$/);
  assert.doesNotMatch(rehearsalSql, /\bCOMMIT\b/i);
  assert.match(rehearsalSql, new RegExp(fixture.returnId));
  assert.match(rehearsalSql, new RegExp(fixture.sourceInvoiceId));
  assert.match(rehearsalSql, /sales_invoice_id/);
  assert.match(rehearsalSql, /a\.code = '2104'/);
});

test("الخطة تعكس البيع والضريبة وتختبر رجوع بطاقة المنتج", () => {
  assert.match(rehearsalSql, /v_debit <> 194 OR v_credit <> 194/);
  for (const code of ["4101", "1103", "2104", "1104", "5101"]) {
    assert.match(rehearsalSql, new RegExp(`account_code' = '${code}'`));
  }
  assert.match(rehearsalSql, /quantity_on_hand = 10/);
  assert.match(rehearsalSql, /quantity_on_hand = 8/);
  assert.match(rehearsalSql, /STAGING_TAX_SALES_RETURN_ROLLBACK_POSTCHECK_FAILED/);
});
