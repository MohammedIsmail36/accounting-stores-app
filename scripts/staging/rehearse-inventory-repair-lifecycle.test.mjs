import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateStagingRepairRehearsalSource } from "./rehearse-inventory-repair-lifecycle.mjs";

const sourcePath = fileURLToPath(new URL("./rehearse-inventory-repair-lifecycle.mjs", import.meta.url));

test("مشغل 2B مقيد بمشروع Staging والنسخة المعتمدة والرجوع الكامل", () => {
  assert.doesNotThrow(() => validateStagingRepairRehearsalSource(readFileSync(sourcePath, "utf8")));
});

test("يرفض المشغل إذا اختفى ROLLBACK", () => {
  const source = readFileSync(sourcePath, "utf8").replaceAll("ROLLBACK;", "COMMIT;");
  assert.throws(() => validateStagingRepairRehearsalSource(source), /حاجز تجربة Staging مفقود/);
});
