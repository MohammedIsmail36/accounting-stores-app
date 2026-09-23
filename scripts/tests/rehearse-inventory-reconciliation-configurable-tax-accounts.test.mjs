import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateConfigurableTaxContractSql,
  validateConfigurableTaxMigrationSql,
  validateConfigurableTaxRollbackSql,
} from "./rehearse-inventory-reconciliation-configurable-tax-accounts.mjs";

const contractPath = fileURLToPath(new URL(
  "../../supabase/tests/inventory_reconciliation_configurable_tax_accounts_contract.sql",
  import.meta.url,
));

test("عقد حسابات الضريبة يحتوي الحواجز والسيناريوهات الثمانية", () => {
  const sql = readFileSync(contractPath, "utf8");
  assert.doesNotThrow(() => validateConfigurableTaxContractSql(sql));
});

test("عقد حسابات الضريبة يرفض الاتصال الخارجي", () => {
  const sql = readFileSync(contractPath, "utf8");
  assert.throws(
    () => validateConfigurableTaxContractSql(`${sql}\nSELECT 'https://example.invalid';`),
    /غير مسموحة/,
  );
});

test("حواجز Migration والرجوع ترفض النصوص الناقصة", () => {
  assert.throws(() => validateConfigurableTaxMigrationSql("BEGIN;"), /جزء مفقود/);
  assert.throws(() => validateConfigurableTaxRollbackSql("BEGIN;"), /جزء مفقود/);
});

test("Migration وملف الرجوع الحاليان يجتازان الفحص الساكن", () => {
  const migration = readFileSync(fileURLToPath(new URL(
    "../../supabase/migrations/20260923100000_inventory_reconciliation_configurable_tax_accounts.sql",
    import.meta.url,
  )), "utf8");
  const rollback = readFileSync(fileURLToPath(new URL(
    "../../supabase/rollback/20260923100000_inventory_reconciliation_configurable_tax_accounts.sql",
    import.meta.url,
  )), "utf8");
  assert.doesNotThrow(() => validateConfigurableTaxMigrationSql(migration));
  assert.doesNotThrow(() => validateConfigurableTaxRollbackSql(rollback));
});
