import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateRepairLifecycleContractSql } from "./rehearse-inventory-repair-lifecycle.mjs";

const sqlPath = fileURLToPath(
  new URL("../../supabase/tests/inventory_reconciliation_repair_lifecycle_contract.sql", import.meta.url),
);

test("يقبل عقد SQL الكامل ذي السيناريوهات الستة عشر", () => {
  assert.doesNotThrow(() => validateRepairLifecycleContractSql(readFileSync(sqlPath, "utf8")));
});

test("يرفض عقداً ناقص السيناريو الأخير", () => {
  const sql = readFileSync(sqlPath, "utf8").replace("Scenario 16", "Scenario missing");
  assert.throws(() => validateRepairLifecycleContractSql(sql), /Scenario 16/);
});

test("يرفض اختباراً قد يثبت بياناته", () => {
  const sql = readFileSync(sqlPath, "utf8").replace("ROLLBACK;", "COMMIT;");
  assert.throws(() => validateRepairLifecycleContractSql(sql));
});
