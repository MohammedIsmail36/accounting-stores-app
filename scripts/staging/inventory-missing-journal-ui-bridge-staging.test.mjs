import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { baselineSql } from "./backup-inventory-missing-journal-ui-bridge-baseline.mjs";

const rehearsalSource = readFileSync(fileURLToPath(new URL(
  "./rehearse-inventory-missing-journal-ui-bridge.mjs", import.meta.url)), "utf8");

test("خط الأساس قراءة فقط ويراقب غياب الجسر", () => {
  assert.match(baselineSql, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(baselineSql, /ROLLBACK;/);
  assert.match(baselineSql, /20260922070000/);
  assert.doesNotMatch(baselineSql, /\b(?:INSERT|UPDATE|DELETE|COMMIT)\b/i);
});

test("تجربة Staging مقيدة بالمشروع وتحتوي الرجوع", () => {
  assert.match(rehearsalSource, /dunzfxurefzlaamgghys/);
  assert.match(rehearsalSource, /STAGING_2D_UI_BRIDGE_EXPLICIT_ROLLBACK_OK/);
  assert.match(rehearsalSource, /ROLLBACK;/);
  assert.doesNotMatch(rehearsalSource, /farida-db|alibea-db|farida\.alibea2020\.com|alibea\.alibea2020\.com/);
});
