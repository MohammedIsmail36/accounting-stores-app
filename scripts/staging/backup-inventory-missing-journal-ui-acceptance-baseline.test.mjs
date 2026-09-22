import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { baselineSql } from "./backup-inventory-missing-journal-ui-bridge-baseline.mjs";

const source = readFileSync(
  fileURLToPath(new URL("./backup-inventory-missing-journal-ui-acceptance-baseline.mjs", import.meta.url)),
  "utf8",
);

test("نسخة قبول 2D مقيدة بـStaging والقراءة فقط", () => {
  for (const required of [
    "dunzfxurefzlaamgghys",
    "migrations.bridge",
    "bridge.function_exists",
    "bridge.trigger_count !== 1",
    "bridge.active_repairs !== 0",
    "STAGING_INVENTORY_MISSING_JOURNAL_UI_ACCEPTANCE_BASELINE_OK",
    "productionModified: false",
  ]) {
    assert.ok(source.includes(required), `حارس مفقود: ${required}`);
  }
  assert.ok(baselineSql.includes("BEGIN TRANSACTION READ ONLY"), "استعلام خط الأساس ليس للقراءة فقط");
  for (const forbidden of [
    ["farida", "-db"].join(""),
    ["alibea", "-db"].join(""),
    ["farida", ".alibea2020.com"].join(""),
    ["alibea", ".alibea2020.com"].join(""),
  ]) {
    assert.equal(source.includes(forbidden), false, `وجهة إنتاجية ممنوعة: ${forbidden}`);
  }
});
