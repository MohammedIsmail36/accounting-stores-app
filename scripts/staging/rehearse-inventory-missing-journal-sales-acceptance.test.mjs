import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./rehearse-inventory-missing-journal-sales-acceptance.mjs", import.meta.url)),
  "utf8",
);

test("تجربة قبول بيع 2D مقيدة بـStaging وتنتهي برجوع كامل", () => {
  for (const required of [
    "dunzfxurefzlaamgghys",
    "STAGING_2D_SALES_FIXTURE_REHEARSAL_OK",
    "STAGING_2D_SALES_REHEARSAL_ROLLBACK_REFUSED",
    "movement_without_journal",
    "create_full_journal",
    "ROLLBACK;",
    "explicit-rollback.sql",
    "delete normalized.diagnostic.snapshot_at",
    "productionModified: false",
    "'1103'",
    "'4101'",
    "'5101'",
    "'1104'",
  ]) {
    assert.ok(source.includes(required), `حارس مفقود: ${required}`);
  }
  for (const forbidden of [
    ["farida", "-db"].join(""),
    ["alibea", "-db"].join(""),
    ["farida", ".alibea2020.com"].join(""),
    ["alibea", ".alibea2020.com"].join(""),
    "--apply",
  ]) {
    assert.equal(source.includes(forbidden), false, `وجهة أو وضع ممنوع: ${forbidden}`);
  }
});
