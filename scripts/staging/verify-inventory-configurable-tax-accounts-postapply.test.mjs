import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  definitionVerificationSql,
  validateVerifierSource,
} from "./verify-inventory-configurable-tax-accounts-postapply.mjs";

const source = readFileSync(fileURLToPath(new URL(
  "./verify-inventory-configurable-tax-accounts-postapply.mjs", import.meta.url,
)), "utf8");

test("فاحص ما بعد التطبيق قراءة فقط ومحصور في Staging", () => {
  assert.doesNotThrow(() => validateVerifierSource(source));
  for (const required of [
    "BEGIN TRANSACTION READ ONLY;",
    "ROLLBACK;",
    "v_purchase_tax_code",
    "v_sales_tax_code",
    "account_type = ''asset''",
    "account_type = ''liability''",
  ]) assert.ok(definitionVerificationSql.includes(required), `فحص مفقود: ${required}`);
  assert.doesNotMatch(definitionVerificationSql, /\b(?:INSERT|UPDATE|DELETE|COMMIT)\b/i);
});
