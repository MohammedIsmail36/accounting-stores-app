import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  validateRepairLifecycleContractSql,
  validateRepairLifecycleMigrationSql,
  validateRepairLifecycleRollbackSql,
} from "./rehearse-inventory-repair-lifecycle.mjs";

const sqlPath = fileURLToPath(
  new URL("../../supabase/tests/inventory_reconciliation_repair_lifecycle_contract.sql", import.meta.url),
);
const migrationPath = fileURLToPath(
  new URL("../../supabase/migrations/20260913234500_inventory_reconciliation_repair_lifecycle.sql", import.meta.url),
);
const rollbackPath = fileURLToPath(
  new URL("../../supabase/rollback/20260913234500_inventory_reconciliation_repair_lifecycle.sql", import.meta.url),
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

test("يقبل Migration دورة الاعتماد التي لا تمس بيانات الأعمال", () => {
  assert.doesNotThrow(() => validateRepairLifecycleMigrationSql(readFileSync(migrationPath, "utf8")));
});

test("يرفض Migration تحاول تعديل كمية المنتج", () => {
  const sql = `${readFileSync(migrationPath, "utf8")}\nUPDATE public.products SET quantity_on_hand = 0;`;
  assert.throws(() => validateRepairLifecycleMigrationSql(sql), /غير مسموحة/);
});

test("يقبل ملف الرجوع الصريح المقيد والخالي من CASCADE", () => {
  assert.doesNotThrow(() => validateRepairLifecycleRollbackSql(readFileSync(rollbackPath, "utf8")));
});

test("يرفض ملف رجوع يستخدم CASCADE", () => {
  const sql = `${readFileSync(rollbackPath, "utf8")}\nDROP TABLE public.fake CASCADE;`;
  assert.throws(() => validateRepairLifecycleRollbackSql(sql), /غير مسموحة/);
});
