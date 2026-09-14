import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateRebuildContractSql,
  validateRebuildMigrationSql,
  validateRebuildRollbackSql,
} from "./rehearse-inventory-rebuild-product-card.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const contract = readFileSync(`${root}supabase/tests/inventory_reconciliation_rebuild_product_card_contract.sql`, "utf8");

test("عقد 2C يحتوي الحواجز والسيناريوهات العشرة", () => {
  assert.doesNotThrow(() => validateRebuildContractSql(contract));
});

test("حواجز Migration وملف الرجوع ترفض وجهة إنتاجية", () => {
  const unsafe = "https://farida.alibea2020.com";
  assert.throws(() => validateRebuildMigrationSql(unsafe), /جزء مفقود|غير مسموحة/);
  assert.throws(() => validateRebuildRollbackSql(unsafe), /جزء مفقود|غير مسموحة/);
});

test("ملف الرجوع مقيد بتفويض Staging ويرفض الرجوع بعد تنفيذ فعلي", () => {
  const rollback = readFileSync(
    `${root}supabase/rollback/20260914190000_inventory_reconciliation_rebuild_product_card_executor.sql`,
    "utf8",
  );
  assert.match(rollback, /STAGING_20260914190000/);
  assert.match(rollback, /INVENTORY_REBUILD_ROLLBACK_HAS_EXECUTIONS/);
  assert.match(rollback, /REPAIR_TYPE_NOT_ENABLED/);
  assert.doesNotMatch(rollback, /\bCASCADE\b/i);
});
