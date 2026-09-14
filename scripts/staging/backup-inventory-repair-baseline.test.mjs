import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateBackupSource } from "./backup-inventory-repair-baseline.mjs";

const sourcePath = fileURLToPath(new URL("./backup-inventory-repair-baseline.mjs", import.meta.url));

test("نسخة ما قبل 2B مقيدة بمشروع Staging ومعاملة قراءة فقط", () => {
  assert.doesNotThrow(() => validateBackupSource(readFileSync(sourcePath, "utf8")));
});

test("يرفض المشغل إذا اختفى حاجز القراءة فقط", () => {
  const source = readFileSync(sourcePath, "utf8").replaceAll("BEGIN TRANSACTION READ ONLY;", "BEGIN;");
  assert.throws(() => validateBackupSource(source), /حاجز النسخة مفقود/);
});
