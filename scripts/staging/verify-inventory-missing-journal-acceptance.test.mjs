import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./verify-inventory-missing-journal-acceptance.mjs", import.meta.url)),
  "utf8",
);

test("فاحص قبول 2D للقراءة فقط ومقيد بـStaging", () => {
  for (const required of [
    "dunzfxurefzlaamgghys",
    "BEGIN TRANSACTION READ ONLY",
    "ROLLBACK;",
    "--draft",
    "--submitted",
    "--approved",
    "--executed",
    "STAGING_2D_PURCHASE_ACCEPTANCE_VERIFIED",
    "NO_CORRECTION_REQUIRED",
    "missing_inventory_journal_created",
    "productionModified: false",
  ]) assert.ok(source.includes(required), `حارس مفقود: ${required}`);

  for (const forbidden of [
    ["farida", "-db"].join(""),
    ["alibea", "-db"].join(""),
    ["farida", ".alibea2020.com"].join(""),
    ["alibea", ".alibea2020.com"].join(""),
  ]) assert.equal(source.includes(forbidden), false, `وجهة إنتاجية ممنوعة: ${forbidden}`);
});
