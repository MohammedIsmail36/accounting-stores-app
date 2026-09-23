import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./verify-inventory-missing-journal-acceptance.mjs", import.meta.url)),
  "utf8",
);

test("فاحص قبول 2D مشترك للشراء والبيع، للقراءة فقط ومقيد بـStaging", () => {
  for (const required of [
    "dunzfxurefzlaamgghys",
    "BEGIN TRANSACTION READ ONLY",
    "ROLLBACK;",
    "--draft",
    "--submitted",
    "--approved",
    "--executed",
    "--purchase",
    "--sales",
    "STAGING_2D_PURCHASE_ACCEPTANCE_VERIFIED",
    "STAGING_2D_SALES_ACCEPTANCE_VERIFIED",
    "opening_balance",
    "staging_seed",
    "NO_CORRECTION_REQUIRED",
    "missing_inventory_journal_created",
    "journalPostedNumber: 312",
    "journalPostedNumber: 314",
    "openingPostedNumber: 313",
    "journal_entry_prefix",
    "officialJournalNumber",
    "productionModified: false",
  ]) assert.ok(source.includes(required), `حارس مفقود: ${required}`);

  for (const forbidden of [
    ["farida", "-db"].join(""),
    ["alibea", "-db"].join(""),
    ["farida", ".alibea2020.com"].join(""),
    ["alibea", ".alibea2020.com"].join(""),
  ]) assert.equal(source.includes(forbidden), false, `وجهة إنتاجية ممنوعة: ${forbidden}`);
});
