import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateInventoryReconciliationTestSql } from "./rehearse-inventory-reconciliation-baseline.mjs";

const sqlPath = fileURLToPath(
  new URL("../../supabase/tests/inventory_reconciliation_baseline.sql", import.meta.url),
);

test("يقبل عقد SQL المعزول الحالي", () => {
  assert.doesNotThrow(() =>
    validateInventoryReconciliationTestSql(readFileSync(sqlPath, "utf8")),
  );
});

test("يرفض اختباراً قد يثبت كتابة بدلاً من الرجوع", () => {
  const unsafe = readFileSync(sqlPath, "utf8").replace("ROLLBACK;", "COMMIT;");
  assert.throws(() => validateInventoryReconciliationTestSql(unsafe));
});

test("يرفض أي اتصال أو اسم حاوية إنتاج", () => {
  const unsafe = `${readFileSync(sqlPath, "utf8")}\n-- farida-db`;
  assert.throws(() => validateInventoryReconciliationTestSql(unsafe));
});
