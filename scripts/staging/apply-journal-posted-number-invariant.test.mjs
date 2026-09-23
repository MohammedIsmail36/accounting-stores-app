import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  stateSql,
  validateApplySource,
} from "./apply-journal-posted-number-invariant.mjs";

const source = readFileSync(
  fileURLToPath(new URL("./apply-journal-posted-number-invariant.mjs", import.meta.url)),
  "utf8",
);

test("التطبيق محصور في Staging ويشترط الفحص الجاف والنسخة والتجربة", () => {
  assert.doesNotThrow(() => validateApplySource(source));
  for (const required of [
    "migration-dry-run",
    "migration-apply",
    "pre-apply-verification",
    "post-apply-verification",
    "baselineRestoredAfterRollback",
  ]) assert.ok(source.includes(required), `حارس مفقود: ${required}`);
});

test("التحقق اللاحق يثبت البادئة والحماية وعدم تغير جوهر القيود", () => {
  for (const required of [
    "BEGIN TRANSACTION READ ONLY;",
    "journal_entry_prefix",
    "core_signature",
    "lines_signature",
    "posted_without_number",
    "duplicate_posted_numbers",
    "ROLLBACK;",
  ]) assert.ok(stateSql.includes(required), `فحص مفقود: ${required}`);
  assert.equal(source.includes("'JV-'"), false);
});
