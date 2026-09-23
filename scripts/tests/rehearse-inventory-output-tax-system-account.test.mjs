import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  validateOutputTaxContractSql,
  validateOutputTaxDefaultsSource,
  validateOutputTaxMigrationSql,
  validateOutputTaxRollbackSql,
} from "./rehearse-inventory-output-tax-system-account.mjs";

const contractPath = fileURLToPath(new URL(
  "../../supabase/tests/inventory_output_tax_system_account_contract.sql",
  import.meta.url,
));
const runnerPath = fileURLToPath(new URL(
  "./rehearse-inventory-output-tax-system-account.mjs",
  import.meta.url,
));
const migrationPath = fileURLToPath(new URL(
  "../../supabase/migrations/20260923130000_inventory_output_tax_system_account.sql",
  import.meta.url,
));
const rollbackPath = fileURLToPath(new URL(
  "../../supabase/rollback/20260923130000_inventory_output_tax_system_account.sql",
  import.meta.url,
));
const defaultsPath = fileURLToPath(new URL(
  "../../supabase/functions/_shared/system-defaults.ts",
  import.meta.url,
));
const seedSystemPath = fileURLToPath(new URL(
  "../../supabase/functions/seed-system/index.ts",
  import.meta.url,
));
const databaseBackupPath = fileURLToPath(new URL(
  "../../supabase/functions/database-backup/index.ts",
  import.meta.url,
));

test("عقد حساب ضريبة المخرجات يغطي السيناريوهات الثمانية وحواجز العزل", () => {
  const contract = readFileSync(contractPath, "utf8");
  assert.doesNotThrow(() => validateOutputTaxContractSql(contract));
  assert.match(contract, /EXCEPTION WHEN check_violation OR raise_exception/);
});

test("يرفض العقد الناقص أو المتصل ببيئة مستضافة", () => {
  const contract = readFileSync(contractPath, "utf8");
  assert.throws(
    () => validateOutputTaxContractSql(contract.replace("Scenario 08", "Missing 08")),
    /سيناريو حساب ضريبة المخرجات مفقود/,
  );
  assert.throws(
    () => validateOutputTaxContractSql(`${contract}\nhttps://staging.example.test`),
    /عبارة غير مسموحة/,
  );
});

test("يحافظ المشغل على أمر psql ذي الشرطة العكسية", () => {
  const runner = readFileSync(runnerPath, "utf8");
  assert.match(runner, /psql\(`\\\\set ON_ERROR_STOP on/);
});

test("Migration والرجوع ومصدر التهيئة يحققون العقد المعماري", () => {
  assert.doesNotThrow(() => validateOutputTaxMigrationSql(readFileSync(migrationPath, "utf8")));
  assert.doesNotThrow(() => validateOutputTaxRollbackSql(readFileSync(rollbackPath, "utf8")));
  assert.doesNotThrow(() => validateOutputTaxDefaultsSource(readFileSync(defaultsPath, "utf8")));
});

test("مسارا التهيئة وإعادة البناء يربطان 1105 و2104 افتراضيًا", () => {
  for (const path of [seedSystemPath, databaseBackupPath]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /purchase_tax_account_id:\s*[^\n]*codeToId\["1105"\]/);
    assert.match(source, /sales_tax_account_id:\s*[^\n]*codeToId\["2104"\]/);
  }
});
