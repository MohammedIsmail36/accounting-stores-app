import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateDiagnosticContractSql } from "./rehearse-inventory-reconciliation-diagnostic.mjs";

const sqlPath = fileURLToPath(
  new URL("../../supabase/tests/inventory_reconciliation_diagnostic_contract.sql", import.meta.url),
);

test("يقبل عقد SQL الذي يغطي السيناريوهات الستة عشر", () => {
  assert.doesNotThrow(() => validateDiagnosticContractSql(readFileSync(sqlPath, "utf8")));
});

test("يرفض عقداً ناقص السيناريو الأخير", () => {
  const sql = readFileSync(sqlPath, "utf8").replace("Scenario 16", "Scenario missing");
  assert.throws(() => validateDiagnosticContractSql(sql), /Scenario 16/);
});

test("يرفض تثبيت بيانات الاختبار", () => {
  const sql = readFileSync(sqlPath, "utf8").replace("ROLLBACK;", "COMMIT;");
  assert.throws(() => validateDiagnosticContractSql(sql));
});
