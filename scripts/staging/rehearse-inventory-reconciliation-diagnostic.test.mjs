import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateStagingRehearsalSource } from "./rehearse-inventory-reconciliation-diagnostic.mjs";

const scriptPath = fileURLToPath(
  new URL("./rehearse-inventory-reconciliation-diagnostic.mjs", import.meta.url),
);

test("يقبل مشغل Staging ذي حواجز الوجهة والرجوع", () => {
  assert.doesNotThrow(() => validateStagingRehearsalSource(readFileSync(scriptPath, "utf8")));
});

test("يرفض المشغل إذا فقد علامة تحقق الرجوع", () => {
  const source = readFileSync(scriptPath, "utf8").replaceAll(
    "STAGING_DIAGNOSTIC_ROLLBACK_OK",
    "REMOVED_ROLLBACK_MARKER",
  );
  assert.throws(() => validateStagingRehearsalSource(source), /حاجز Staging مفقود/);
});
