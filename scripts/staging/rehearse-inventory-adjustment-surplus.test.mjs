import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./backup-inventory-adjustment-surplus-baseline.mjs";
import { rehearsalSql } from "./rehearse-inventory-adjustment-surplus.mjs";

test("تجربة الفائض مستقلة عن قيد العجز السابق وتنتهي برجوع كامل", () => {
  assert.match(rehearsalSql, /^BEGIN;/);
  assert.match(rehearsalSql, /ROLLBACK;\s*$/);
  assert.match(rehearsalSql, /DO \$explicit_rollback\$/);
  assert.match(rehearsalSql, new RegExp(fixture.adjustmentId));
  assert.match(rehearsalSql, new RegExp(fixture.priorShortageId));
});

test("الخطة تتحقق من قيد فائض متوازن على 1104 و4201", () => {
  assert.match(rehearsalSql, /'1104' AND \(l->>'debit'\)::numeric = 40/);
  assert.match(rehearsalSql, /'4201' AND \(l->>'debit'\)::numeric = 0 AND \(l->>'credit'\)::numeric = 40/);
  assert.match(rehearsalSql, /v_debit <> 40 OR v_credit <> 40/);
  assert.match(rehearsalSql, /STAGING_ADJUSTMENT_SURPLUS_ROLLBACK_REFUSED/);
});
