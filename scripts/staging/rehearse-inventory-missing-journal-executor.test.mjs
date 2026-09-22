import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractNamedPayload, validateStagingMissingJournalRehearsalSource } from
  "./rehearse-inventory-missing-journal-executor.mjs";

const sourcePath = fileURLToPath(new URL(
  "./rehearse-inventory-missing-journal-executor.mjs",
  import.meta.url,
));
const source = readFileSync(sourcePath, "utf8");

test("مشغل تجربة 2D على Staging يحتوي جميع حواجز الأمان", () => {
  assert.doesNotThrow(() => validateStagingMissingJournalRehearsalSource(source));
});

test("يرفض المشغل إذا اختفى ROLLBACK", () => {
  assert.throws(
    () => validateStagingMissingJournalRehearsalSource(source.replaceAll("ROLLBACK;", "")),
    /حاجز تجربة Staging مفقود/,
  );
});

test("يرفض المشغل إذا أضيف COMMIT", () => {
  assert.throws(
    () => validateStagingMissingJournalRehearsalSource(`${source}\nCOMMIT;`),
    /وجهة أو عبارة ممنوعة/,
  );
});

test("يستخرج نتيجة التحقق من غلاف rows", () => {
  assert.deepEqual(
    extractNamedPayload('{"rows":[{"verification":{"result":"OK"}}]}', "verification"),
    { result: "OK" },
  );
});

test("يستخرج نتيجة التحقق من غلاف CLI متداخل", () => {
  assert.deepEqual(
    extractNamedPayload({ result: { data: [{ verification: { result: "OK" } }] } }, "verification"),
    { result: "OK" },
  );
});
