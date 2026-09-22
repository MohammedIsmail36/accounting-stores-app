import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./manage-inventory-missing-journal-acceptance-fixture.mjs", import.meta.url)),
  "utf8",
);

test("حالة قبول 2D مقيدة بـStaging ولها تجربة ورجوع صريح", () => {
  for (const required of [
    "dunzfxurefzlaamgghys",
    "--rehearse",
    "--apply",
    "--rollback",
    "ROLLBACK;",
    "explicit-rollback.sql",
    "STAGING_2D_PURCHASE_FIXTURE_REHEARSAL_OK",
    "STAGING_2D_PURCHASE_FIXTURE_READY",
    "STAGING_2D_PURCHASE_FIXTURE_ROLLBACK_OK",
    "movement_without_journal",
    "create_full_journal",
    "STAGING_2D_ACCEPTANCE_ROLLBACK_REFUSED",
    "delete normalized.diagnostic.snapshot_at",
    "productionModified: false",
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
