import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validatePostApplyVerifierSource } from "./verify-inventory-repair-lifecycle-postapply.mjs";

const sourcePath = fileURLToPath(new URL("./verify-inventory-repair-lifecycle-postapply.mjs", import.meta.url));

test("التحقق اللاحق مقيد بـStaging والقراءة فقط ويشمل RLS والمنح", () => {
  assert.doesNotThrow(() => validatePostApplyVerifierSource(readFileSync(sourcePath, "utf8")));
});

test("يرفض التحقق إذا اختفى حاجز القراءة فقط", () => {
  const source = readFileSync(sourcePath, "utf8").replaceAll("BEGIN TRANSACTION READ ONLY;", "BEGIN;");
  assert.throws(() => validatePostApplyVerifierSource(source), /حاجز تحقق/);
});
