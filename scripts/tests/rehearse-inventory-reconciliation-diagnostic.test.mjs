import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  validateDiagnosticContractSql,
  validateDiagnosticMigrationSql,
} from "./rehearse-inventory-reconciliation-diagnostic.mjs";

const sqlPath = fileURLToPath(
  new URL("../../supabase/tests/inventory_reconciliation_diagnostic_contract.sql", import.meta.url),
);
const migrationPath = fileURLToPath(
  new URL("../../supabase/migrations/20260913160000_inventory_reconciliation_diagnostic.sql", import.meta.url),
);

test("يقبل عقد SQL الذي يغطي السيناريوهات الستة عشر", () => {
  assert.doesNotThrow(() => validateDiagnosticContractSql(readFileSync(sqlPath, "utf8")));
});

test("يرفض عقداً ناقص السيناريو الأخير", () => {
  const sql = readFileSync(sqlPath, "utf8").replace("Scenario 16", "Scenario missing");
  assert.throws(() => validateDiagnosticContractSql(sql), /Scenario 16/);
});

test("يقبل Migration القراءة فقط للدالة الموحدة", () => {
  assert.doesNotThrow(() => validateDiagnosticMigrationSql(readFileSync(migrationPath, "utf8")));
});

test("يرفض Migration تنفذ كتابة على بيانات الأعمال", () => {
  const sql = `${readFileSync(migrationPath, "utf8")}\nUPDATE public.products SET name = name;`;
  assert.throws(() => validateDiagnosticMigrationSql(sql), /غير مسموحة/);
});

test("يرفض تثبيت بيانات الاختبار", () => {
  const sql = readFileSync(sqlPath, "utf8").replace("ROLLBACK;", "COMMIT;");
  assert.throws(() => validateDiagnosticContractSql(sql));
});
