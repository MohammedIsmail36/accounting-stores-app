import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateRebuildBaselineSource } from "./backup-inventory-rebuild-product-card-baseline.mjs";
import { validateStagingRebuildRehearsalSource } from "./rehearse-inventory-rebuild-product-card.mjs";
import { validateRebuildPostApplySource } from "./verify-inventory-rebuild-product-card-postapply.mjs";

const backupPath = fileURLToPath(new URL("./backup-inventory-rebuild-product-card-baseline.mjs", import.meta.url));
const rehearsalPath = fileURLToPath(new URL("./rehearse-inventory-rebuild-product-card.mjs", import.meta.url));
const postApplyPath = fileURLToPath(new URL("./verify-inventory-rebuild-product-card-postapply.mjs", import.meta.url));

test("نسخة ما قبل 2C مقيدة بمشروع Staging ومعاملة قراءة فقط", () => {
  assert.doesNotThrow(() => validateRebuildBaselineSource(readFileSync(backupPath, "utf8")));
});

test("ترفض النسخة إذا اختفى حاجز القراءة فقط", () => {
  const source = readFileSync(backupPath, "utf8").replaceAll("BEGIN TRANSACTION READ ONLY;", "BEGIN;");
  assert.throws(() => validateRebuildBaselineSource(source), /حاجز النسخة مفقود/);
});

test("تجربة 2C مقيدة بمشروع Staging وخط الأساس والرجوع الكامل", () => {
  assert.doesNotThrow(() => validateStagingRebuildRehearsalSource(readFileSync(rehearsalPath, "utf8")));
});

test("ترفض التجربة إذا اختفى ROLLBACK", () => {
  const source = readFileSync(rehearsalPath, "utf8").replaceAll("ROLLBACK;", "COMMIT;");
  assert.throws(() => validateStagingRebuildRehearsalSource(source), /حاجز تجربة Staging مفقود/);
});

test("فحص ما بعد التطبيق مقيد بـStaging ومعاملة قراءة فقط وخط الأساس", () => {
  assert.doesNotThrow(() => validateRebuildPostApplySource(readFileSync(postApplyPath, "utf8")));
});

test("يرفض فحص ما بعد التطبيق إذا اختفى حاجز القراءة فقط", () => {
  const source = readFileSync(postApplyPath, "utf8").replaceAll("BEGIN TRANSACTION READ ONLY;", "BEGIN;");
  assert.throws(() => validateRebuildPostApplySource(source), /حاجز تحقق ما بعد تطبيق 2C مفقود/);
});
