import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./backup-inventory-purchase-return-cost-variance-baseline.mjs";
import { rehearsalSql } from "./rehearse-inventory-purchase-return-cost-variance.mjs";

test("التجربة مقيدة بالمرتجع الجديد والقديم وتنتهي برجوع كامل", () => {
  assert.match(rehearsalSql, /^BEGIN;/);
  assert.match(rehearsalSql, /ROLLBACK;\s*$/);
  assert.match(rehearsalSql, /DO \$explicit_rollback\$/);
  assert.match(rehearsalSql, new RegExp(fixture.returnId));
  assert.match(rehearsalSql, new RegExp(fixture.priorReturnId));
});

test("الخطة تختبر حساب فرق التكلفة 5108 مع ضريبة المدخلات", () => {
  assert.match(rehearsalSql, /'5108' AND \(l->>'debit'\)::numeric = 5/);
  assert.match(rehearsalSql, /'1105' AND \(l->>'debit'\)::numeric = 0 AND \(l->>'credit'\)::numeric = 6\.30/);
  assert.match(rehearsalSql, /'2101' AND \(l->>'debit'\)::numeric = 51\.30/);
  assert.match(rehearsalSql, /v_debit <> 56\.30 OR v_credit <> 56\.30/);
  assert.match(rehearsalSql, /jsonb_array_length\(v_plan->'correction_lines'\) <> 4/);
});
