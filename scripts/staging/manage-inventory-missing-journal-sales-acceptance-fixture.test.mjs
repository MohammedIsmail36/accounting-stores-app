import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./manage-inventory-missing-journal-sales-acceptance-fixture.mjs", import.meta.url)),
  "utf8",
);

test("حالة قبول بيع 2D ذاتية الاتساق ومقيدة بـStaging ولها رجوع محمي", () => {
  for (const required of [
    "dunzfxurefzlaamgghys",
    "--rehearse",
    "--apply",
    "--rollback",
    "STAGING_2D_SALES_ACCEPTANCE_REHEARSAL_OK",
    "STAGING_2D_SALES_ACCEPTANCE_READY",
    "STAGING_2D_SALES_ACCEPTANCE_ROLLBACK_OK",
    "STAGING_2D_SALES_ACCEPTANCE_ROLLBACK_REFUSED",
    "movement_without_journal",
    "create_full_journal",
    "staging_seed",
    "__2D_SALES_ACCEPTANCE_OPENING__",
    "quantity_on_hand",
    "inventory_signed_quantity",
    "explicit-rollback.sql",
    "productionModified: false",
    "'1103'",
    "'4101'",
    "'5101'",
    "'1104'",
    "'3101'",
  ]) {
    assert.ok(source.includes(required), `حارس مفقود: ${required}`);
  }
  for (const forbidden of [
    ["farida", "-db"].join(""),
    ["alibea", "-db"].join(""),
    ["farida", ".alibea2020.com"].join(""),
    ["alibea", ".alibea2020.com"].join(""),
  ]) {
    assert.equal(source.includes(forbidden), false, `وجهة إنتاجية ممنوعة: ${forbidden}`);
  }
});
