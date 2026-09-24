import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./backup-inventory-tax-purchase-return-acceptance-baseline.mjs";
import { rehearsalSql } from "./rehearse-inventory-tax-purchase-return-acceptance.mjs";

test("التجربة مقيدة بمرتجع الشراء الضريبي وتنتهي بالرجوع", () => {
  assert.match(rehearsalSql, /^BEGIN;/);
  assert.match(rehearsalSql, /ROLLBACK;\s*$/);
  assert.match(rehearsalSql, /DO \$explicit_rollback\$/);
  assert.match(rehearsalSql, new RegExp(fixture.returnId));
  assert.match(rehearsalSql, /purchase_invoice_id/);
  assert.match(rehearsalSql, /'purchase_return'/);
});

test("الخطة تثبت الضريبة وحساب الموردين والمخزون دون فرق تكلفة", () => {
  assert.match(rehearsalSql, /'2101' AND \(l->>'debit'\)::numeric = 57/);
  assert.match(rehearsalSql, /'1104' AND \(l->>'debit'\)::numeric = 0 AND \(l->>'credit'\)::numeric = 50/);
  assert.match(rehearsalSql, /'1105' AND \(l->>'debit'\)::numeric = 0 AND \(l->>'credit'\)::numeric = 7/);
  assert.match(rehearsalSql, /jsonb_array_length\(v_plan->'correction_lines'\) <> 3/);
  assert.match(rehearsalSql, /v_debit <> 57 OR v_credit <> 57/);
});
