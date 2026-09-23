import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateVerifierSource,
  verificationSql,
} from "./verify-journal-posted-number-postapply.mjs";

const source = readFileSync(
  fileURLToPath(new URL("./verify-journal-posted-number-postapply.mjs", import.meta.url)),
  "utf8",
);

test("فاحص ما بعد التطبيق للقراءة فقط ومحصور في Staging", () => {
  assert.doesNotThrow(() => validateVerifierSource(source));
  for (const required of [
    "BEGIN TRANSACTION READ ONLY;",
    "audit_proof",
    "only_number_and_timestamp_changed",
    "posted_without_number",
    "duplicate_posted_numbers",
    "ROLLBACK;",
  ]) assert.ok(verificationSql.includes(required), `شرط مفقود: ${required}`);
});

test("لا يثبت الفاحص بادئة عرض أو وجهة إنتاجية", () => {
  assert.equal(source.includes("'JV-'"), false);
  assert.equal(source.includes(["farida", "-db"].join("")), false);
  assert.equal(source.includes(["alibea", "-db"].join("")), false);
});
