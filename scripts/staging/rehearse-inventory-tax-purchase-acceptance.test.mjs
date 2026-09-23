import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { rehearsalSql } from "./rehearse-inventory-tax-purchase-acceptance.mjs";

const source = readFileSync(
  fileURLToPath(new URL("./rehearse-inventory-tax-purchase-acceptance.mjs", import.meta.url)),
  "utf8",
);

test("تجربة الشراء الضريبي مقيدة بـStaging وتنتهي بالرجوع", () => {
  for (const required of [
    "BEGIN;",
    "ROLLBACK;",
    "enable_tax = true, tax_rate = 14",
    "STAGING_TAX_PURCHASE_ACCEPTANCE_REHEARSAL_OK",
    "movement_without_journal",
    "create_full_journal",
    "'1104'",
    "'1105'",
    "'2101'",
  ]) {
    assert.ok(rehearsalSql.includes(required), `حارس مفقود: ${required}`);
  }
  assert.ok(source.includes("dunzfxurefzlaamgghys"), "حارس هوية Staging مفقود");
});

test("القيد المتوقع متوازن ويستخدم حساب الضريبة المعد", () => {
  assert.match(rehearsalSql, /v_debit <> 114 OR v_credit <> 114/);
  assert.match(rehearsalSql, /account_code' = '1105'[\s\S]*debit'\)::numeric = 14/);
  assert.match(rehearsalSql, /account_code' = '2101'[\s\S]*credit'\)::numeric = 114/);
});
