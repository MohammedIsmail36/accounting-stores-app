import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateJournalPostedNumberContract,
  validateJournalPostedNumberMigration,
  validateJournalPostedNumberRollback,
  transactionBody,
} from "./rehearse-journal-posted-number-invariant.mjs";

const contract = readFileSync(
  fileURLToPath(new URL("../../supabase/tests/journal_posted_number_invariant_contract.sql", import.meta.url)),
  "utf8",
);
const runner = readFileSync(
  fileURLToPath(new URL("./rehearse-journal-posted-number-invariant.mjs", import.meta.url)),
  "utf8",
);
const migration = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20260923030000_journal_posted_number_invariant.sql", import.meta.url)),
  "utf8",
);
const rollback = readFileSync(
  fileURLToPath(new URL("../../supabase/rollback/20260923030000_journal_posted_number_invariant.sql", import.meta.url)),
  "utf8",
);

test("عقد ترقيم القيود يثبت ثمانية سيناريوهات ولا يثبت بادئة العرض", () => {
  assert.doesNotThrow(() => validateJournalPostedNumberContract(contract));
  for (let index = 1; index <= 8; index += 1) {
    assert.ok(contract.includes(`Scenario ${String(index).padStart(2, "0")}`));
  }
  assert.equal(contract.includes("JV-"), false);
});

test("مشغل العقد مقيد بحاوية L3 ولا يتصل بقاعدة مستضافة", () => {
  for (const required of [
    "assertIsolation", "TDD_JOURNAL_POSTED_NUMBER_INVARIANT_RED_OK",
    "--expect-missing", "--run-migration", "--test-explicit-rollback",
    "journal_entries_posted_number_required", "legacyFixtureSql",
  ]) assert.ok(runner.includes(required), `حارس مفقود: ${required}`);
  for (const forbidden of [
    ["farida", "-db"].join(""),
    ["alibea", "-db"].join(""),
    ["farida", ".alibea2020.com"].join(""),
    ["alibea", ".alibea2020.com"].join(""),
    "supabase db query",
  ]) assert.equal(runner.includes(forbidden), false, `وجهة ممنوعة: ${forbidden}`);
});

test("Migration ترقم القيود ذريًا وملف الرجوع لا يمحو الأرقام المعينة", () => {
  assert.doesNotThrow(() => validateJournalPostedNumberMigration(migration));
  assert.doesNotThrow(() => validateJournalPostedNumberRollback(rollback));
  assert.ok(migration.includes("row_number() OVER (ORDER BY entry_number, id)"));
  assert.equal(migration.includes("JV-"), false);
  assert.equal(rollback.includes("JV-"), false);
  assert.doesNotMatch(rollback, /SET\s+posted_number\s*=\s*NULL/i);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;\s*$/);
  assert.match(rollback, /BEGIN;[\s\S]*COMMIT;\s*$/);
  assert.equal(transactionBody(migration).includes("COMMIT;"), false);
  assert.equal(transactionBody(rollback).includes("COMMIT;"), false);
});
