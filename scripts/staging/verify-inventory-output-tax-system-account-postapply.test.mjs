import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateVerifierSource } from "./verify-inventory-output-tax-system-account-postapply.mjs";

const source = readFileSync(fileURLToPath(new URL(
  "./verify-inventory-output-tax-system-account-postapply.mjs", import.meta.url,
)), "utf8");

test("فاحص ما بعد التطبيق مستقل ومحصور في Staging والقراءة فقط", () => {
  assert.doesNotThrow(() => validateVerifierSource(source));
  for (const required of ["business-verification", "schema-verification",
    "validatePostApplyBusiness", "validateOutputTaxState"]) {
    assert.ok(source.includes(required), `فحص مفقود: ${required}`);
  }
  assert.doesNotMatch(source, /(?:farida|alibea)-db/i);
});
