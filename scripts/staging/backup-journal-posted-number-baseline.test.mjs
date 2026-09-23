import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  baselineSql,
  extractNamedPayload,
  validateBaseline,
} from "./backup-journal-posted-number-baseline.mjs";

const source = readFileSync(
  fileURLToPath(new URL("./backup-journal-posted-number-baseline.mjs", import.meta.url)),
  "utf8",
);

test("نسخة ترقيم القيود مقيدة بـStaging وتعمل للقراءة فقط", () => {
  for (const required of [
    "dunzfxurefzlaamgghys",
    "BEGIN TRANSACTION READ ONLY;",
    "ROLLBACK;",
    "journal_entry_prefix",
    "posted_without_number",
    "duplicate_posted_numbers",
  ]) assert.ok(`${source}\n${baselineSql}`.includes(required), `حاجز مفقود: ${required}`);
  for (const forbidden of [
    ["farida", "-db"].join(""),
    ["alibea", "-db"].join(""),
    ["farida", ".alibea2020.com"].join(""),
    ["alibea", ".alibea2020.com"].join(""),
  ]) assert.equal(source.includes(forbidden), false, `وجهة ممنوعة: ${forbidden}`);
});

test("يرفض خط الأساس أي عدد أو هوية غير القيود الثلاثة المعروفة", () => {
  const valid = {
    database: "postgres",
    project_ref: "dunzfxurefzlaamgghys",
    server_version: "17.6",
    migration_present: false,
    guard_state: {
      constraint_present: false,
      unique_index_present: false,
      create_gateway_atomic: false,
      replace_gateway_atomic: false,
    },
    configured_prefix: "JV-",
    journal_state: { posted_without_number: 3, duplicate_posted_numbers: 0 },
    missing_rows: [
      { id: "13ab0c2f-36eb-46f4-8303-7fe4ffd3ed62" },
      { id: "48e27ca9-0ad1-4c47-9765-457f8181ff61" },
      { id: "4f131e2f-14d1-4e4d-ada1-31830fa1ea70" },
    ],
  };
  assert.doesNotThrow(() => validateBaseline(valid));
  assert.throws(() => validateBaseline({ ...valid, migration_present: true }));
  assert.throws(() => validateBaseline({
    ...valid,
    journal_state: { posted_without_number: 4, duplicate_posted_numbers: 0 },
  }));
});

test("يستخرج baseline من تغليف Supabase المتداخل", () => {
  const expected = { database: "postgres" };
  assert.deepEqual(extractNamedPayload({ rows: [{ baseline: expected }] }, "baseline"), expected);
  assert.deepEqual(extractNamedPayload([{ result: { baseline: expected } }], "baseline"), expected);
});
