import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./backup-inventory-adjustment-shortage-baseline.mjs";
import { rehearsalSql } from "./rehearse-inventory-adjustment-shortage.mjs";

test("التجربة مقيدة بالتسوية وحركة العجز وتنتهي برجوع كامل", () => {
  assert.match(rehearsalSql, /^BEGIN;/);
  assert.match(rehearsalSql, /ROLLBACK;\s*$/);
  assert.match(rehearsalSql, /DO \$explicit_rollback\$/);
  assert.match(rehearsalSql, new RegExp(fixture.adjustmentId));
  assert.match(rehearsalSql, /quantity_on_hand = 9/);
});

test("الخطة تتحقق من قيد عجز متوازن على 5201 و1104", () => {
  assert.match(rehearsalSql, /'5201' AND \(l->>'debit'\)::numeric = 40/);
  assert.match(rehearsalSql, /'1104' AND \(l->>'debit'\)::numeric = 0 AND \(l->>'credit'\)::numeric = 40/);
  assert.match(rehearsalSql, /v_debit <> 40 OR v_credit <> 40/);
  assert.match(rehearsalSql, /STAGING_ADJUSTMENT_SHORTAGE_ROLLBACK_REFUSED/);
});
