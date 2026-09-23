// TDD contract for configurable tax mappings in inventory reconciliation, isolated L3 only.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const contractPath = join(
  root,
  "supabase/tests/inventory_reconciliation_configurable_tax_accounts_contract.sql",
);
const migrationPath = join(
  root,
  "supabase/migrations/20260923100000_inventory_reconciliation_configurable_tax_accounts.sql",
);
const rollbackPath = join(
  root,
  "supabase/rollback/20260923100000_inventory_reconciliation_configurable_tax_accounts.sql",
);
const diagnosticMigrationPath = join(
  root,
  "supabase/migrations/20260913160000_inventory_reconciliation_diagnostic.sql",
);
const lifecycleMigrationPath = join(
  root,
  "supabase/migrations/20260913234500_inventory_reconciliation_repair_lifecycle.sql",
);
const rebuildMigrationPath = join(
  root,
  "supabase/migrations/20260914190000_inventory_reconciliation_rebuild_product_card_executor.sql",
);
const systemAccountsMigrationPath = join(
  root,
  "supabase/migrations/20260921213000_inventory_reconciliation_system_accounts.sql",
);
const plannerMigrationPath = join(
  root,
  "supabase/migrations/20260921220000_inventory_reconciliation_missing_journal_plan.sql",
);
const executorMigrationPath = join(
  root,
  "supabase/migrations/20260921233000_inventory_reconciliation_missing_journal_executor.sql",
);
const marker = "INVENTORY_RECONCILIATION_CONFIGURABLE_TAX_ACCOUNTS_CONTRACT_OK";

export function validateConfigurableTaxContractSql(sql) {
  for (const required of [
    "BEGIN;",
    "ROLLBACK;",
    "current_database() <> 'l3_public_restore'",
    marker,
    "purchase_tax_account_id",
    "sales_tax_account_id",
    "TAX_ACCOUNT_MAPPING_INVALID",
    "plan_fingerprint",
    "T2DPA",
    "T2DSA",
  ]) {
    if (!sql.includes(required)) {
      throw new Error(`حاجز أو شرط مفقود من عقد حسابات الضريبة: ${required}`);
    }
  }
  for (let index = 1; index <= 8; index += 1) {
    const label = `Scenario ${String(index).padStart(2, "0")}`;
    if (!sql.includes(label)) {
      throw new Error(`سيناريو حسابات الضريبة مفقود: ${label}`);
    }
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) {
      throw new Error(`عبارة غير مسموحة في عقد حسابات الضريبة: ${pattern}`);
    }
  }
}

export function validateConfigurableTaxMigrationSql(sql) {
  for (const required of [
    "INVENTORY_RECONCILIATION_CONFIGURABLE_TAX_BASELINE_MISMATCH",
    "fn_validate_company_tax_account_mapping",
    "trg_validate_company_tax_account_mapping",
    "get_inventory_reconciliation_journal_plan_base_2da",
    "TAX_ACCOUNT_MAPPING_INVALID",
    "purchase_tax_account_id",
    "sales_tax_account_id",
  ]) {
    if (!sql.includes(required)) {
      throw new Error(`جزء مفقود من Migration حسابات الضريبة: ${required}`);
    }
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) {
      throw new Error(`عبارة غير مسموحة في Migration حسابات الضريبة: ${pattern}`);
    }
  }
}

export function validateConfigurableTaxRollbackSql(sql) {
  for (const required of [
    "STAGING_20260923100000",
    "INVENTORY_RECONCILIATION_CONFIGURABLE_TAX_ROLLBACK_NOT_AUTHORIZED",
    "DROP TRIGGER trg_validate_company_tax_account_mapping",
    "DROP FUNCTION public.fn_validate_company_tax_account_mapping()",
    "get_inventory_reconciliation_journal_plan_base_2da",
  ]) {
    if (!sql.includes(required)) {
      throw new Error(`جزء مفقود من ملف رجوع حسابات الضريبة: ${required}`);
    }
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bCASCADE\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) {
      throw new Error(`عبارة غير مسموحة في ملف رجوع حسابات الضريبة: ${pattern}`);
    }
  }
}

function runDocker(args, input) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(result.stderr?.trim() || result.error?.message || "فشل فحص L3");
  }
  return result.stdout.trim();
}

function psql(query) {
  return runDocker([
    "exec", "-i", container, "psql", "-h", "/tmp", "-U", "postgres",
    "-d", database, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-",
  ], query);
}

const businessStateSql = `SELECT jsonb_build_object(
  'accounts', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(a)::text, '|' ORDER BY a.id), ''))) FROM public.accounts a),
  'company_settings', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), ''))) FROM public.company_settings s),
  'products', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), ''))) FROM public.products p),
  'inventory_movements', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id), ''))) FROM public.inventory_movements m),
  'journal_entries', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id), ''))) FROM public.journal_entries j),
  'journal_entry_lines', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), ''))) FROM public.journal_entry_lines l)
);`;

function prerequisiteSql() {
  return [
    diagnosticMigrationPath,
    lifecycleMigrationPath,
    rebuildMigrationPath,
    systemAccountsMigrationPath,
    plannerMigrationPath,
    executorMigrationPath,
  ].map((path) => readFileSync(path, "utf8")).join("\n");
}

const schemaStateSql = `SELECT jsonb_build_object(
  'public_planner', to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NOT NULL,
  'base_planner', to_regprocedure('public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)') IS NOT NULL,
  'legacy_tax_planner', to_regprocedure('public.get_inventory_reconciliation_journal_plan_base_2da_fixed_tax(text,uuid,date)') IS NOT NULL,
  'settings_validator', to_regprocedure('public.fn_validate_company_tax_account_mapping()') IS NOT NULL,
  'account_guard', to_regprocedure('public.fn_guard_configured_tax_account_shape()') IS NOT NULL,
  'settings_trigger', EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.company_settings'::regclass
      AND tgname = 'trg_validate_company_tax_account_mapping'
      AND NOT tgisinternal
  ),
  'account_trigger', EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.accounts'::regclass
      AND tgname = 'trg_guard_configured_tax_account_shape'
      AND NOT tgisinternal
  )
);`;

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--expect-missing", "--run-migration", "--test-explicit-rollback", "--run-all"].includes(mode)
      || process.argv.length > 3) {
    throw new Error("استخدم --check أو --expect-missing أو --run-migration أو --test-explicit-rollback أو --run-all");
  }

  const contract = readFileSync(contractPath, "utf8");
  validateConfigurableTaxContractSql(contract);
  const migrationExists = existsSync(migrationPath);
  const rollbackExists = existsSync(rollbackPath);

  if (mode === "--check") {
    if (migrationExists !== rollbackExists) {
      throw new Error("يجب وجود Migration حسابات الضريبة وملف رجوعها معًا");
    }
    if (migrationExists) {
      validateConfigurableTaxMigrationSql(readFileSync(migrationPath, "utf8"));
      validateConfigurableTaxRollbackSql(readFileSync(rollbackPath, "utf8"));
    }
    console.log(`تم التحقق من عقد حسابات الضريبة؛ Migration ${migrationExists ? "موجودة" : "غير موجودة"}`);
    return;
  }

  if (mode === "--expect-missing" && (migrationExists || rollbackExists)) {
    throw new Error("ملفات إصلاح حسابات الضريبة موجودة؛ لم تعد مرحلة TDD الحمراء صالحة");
  }
  if (mode !== "--expect-missing" && (!migrationExists || !rollbackExists)) {
    throw new Error("Migration حسابات الضريبة أو ملف رجوعها غير موجود");
  }

  assertIsolation(JSON.parse(runDocker(["inspect", container]))[0]);
  const before = psql(businessStateSql);
  const schemaBefore = psql(schemaStateSql);

  if (mode === "--expect-missing") {
    const output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${prerequisiteSql()}
DO $red$
DECLARE v_source text;
BEGIN
  v_source := pg_get_functiondef(
    'public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)'::regprocedure
  );
  IF v_source !~ '1105'
     OR v_source !~ '2102' THEN
    RAISE EXCEPTION 'CONFIGURABLE_TAX_DEFECT_NOT_REPRODUCED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.company_settings'::regclass
      AND tgname = 'trg_validate_company_tax_account_mapping'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'CONFIGURABLE_TAX_GUARD_UNEXPECTEDLY_EXISTS';
  END IF;
END;
$red$;
SELECT 'TDD_CONFIGURABLE_TAX_ACCOUNTS_RED_OK';
ROLLBACK;`);
    const after = psql(businessStateSql);
    if (!output.includes("TDD_CONFIGURABLE_TAX_ACCOUNTS_RED_OK") || before !== after) {
      throw new Error("فشل إثبات TDD الأحمر لحسابات الضريبة أو تغيرت بيانات L3");
    }
    console.log("TDD_CONFIGURABLE_TAX_ACCOUNTS_RED_OK: العقد جاهز والمخطط ما زال يفرض 1105/2102 بدل الحسابين المعدين");
    console.log("لم تُنفذ سيناريوهات العقد ولم تتغير L3 أو Staging أو الإنتاج");
    return;
  }

  const migration = readFileSync(migrationPath, "utf8");
  const rollback = readFileSync(rollbackPath, "utf8");
  validateConfigurableTaxMigrationSql(migration);
  validateConfigurableTaxRollbackSql(rollback);

  let migrationVerified = false;
  if (mode === "--run-migration" || mode === "--run-all") {
    const output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${prerequisiteSql()}
${migration}
${contract}`);
    const after = psql(businessStateSql);
    const schemaAfter = psql(schemaStateSql);
    if (!output.includes(marker) || before !== after || schemaBefore !== schemaAfter) {
      throw new Error("فشل عقد حسابات الضريبة أو لم تعد L3 إلى خط الأساس");
    }
    migrationVerified = true;
    console.log("نجحت Migration حسابات الضريبة القابلة للتهيئة في السيناريوهات الثمانية داخل L3 المعزولة");
    console.log("تم الرجوع عن Migration والعينات بالكامل؛ لم تتغير L3 أو Staging أو الإنتاج");
    if (mode === "--run-migration") return;
  }

  const output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${prerequisiteSql()}
${migration}
UPDATE public.company_settings
SET purchase_tax_account_id = (SELECT id FROM public.accounts WHERE code = '1105'),
    sales_tax_account_id = (SELECT id FROM public.accounts WHERE code = '2102');
SELECT set_config(
  'app.inventory_configurable_tax_accounts_rollback_authorized',
  'STAGING_20260923100000', true
);
${rollback}
DO $verify$
DECLARE v_source text;
BEGIN
  IF to_regprocedure('public.get_inventory_reconciliation_journal_plan_base_2da_fixed_tax(text,uuid,date)') IS NOT NULL
     OR to_regprocedure('public.fn_validate_company_tax_account_mapping()') IS NOT NULL
     OR to_regprocedure('public.fn_guard_configured_tax_account_shape()') IS NOT NULL THEN
    RAISE EXCEPTION 'CONFIGURABLE_TAX_ROLLBACK_INCOMPLETE';
  END IF;
  v_source := pg_get_functiondef(
    'public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)'::regprocedure
  );
  IF v_source !~ '1105' OR v_source !~ '2102' THEN
    RAISE EXCEPTION 'FIXED_TAX_BASE_NOT_RESTORED';
  END IF;
END;
$verify$;
SELECT 'CONFIGURABLE_TAX_EXPLICIT_ROLLBACK_OK';
ROLLBACK;`);
  const after = psql(businessStateSql);
  const schemaAfter = psql(schemaStateSql);
  if (!output.includes("CONFIGURABLE_TAX_EXPLICIT_ROLLBACK_OK")
      || before !== after || schemaBefore !== schemaAfter) {
    throw new Error("فشل ملف الرجوع الصريح أو لم تعد L3 إلى خط الأساس");
  }
  console.log("نجح اختبار ملف رجوع حسابات الضريبة القابلة للتهيئة داخل L3 المعزولة");
  console.log("عادت الدالة ذات الرمزين الافتراضيين وأزيلت الحواجز الجديدة؛ لم تتغير Staging أو الإنتاج");
  if (mode === "--run-all") {
    const reportDir = mkdtempSync(join(tmpdir(), "accounting-configurable-tax-accounts-report-"));
    writeFileSync(join(reportDir, "report.json"), `${JSON.stringify({
      result: "INVENTORY_RECONCILIATION_CONFIGURABLE_TAX_ACCOUNTS_L3_OK",
      database,
      container,
      isolated: true,
      scenarios: 8,
      migration_verified: migrationVerified,
      explicit_rollback_verified: true,
      business_state_restored: before === after,
      schema_state_restored: schemaBefore === schemaAfter,
      migration: migrationPath.replace(`${root}/`, ""),
      rollback: rollbackPath.replace(`${root}/`, ""),
      contract: contractPath.replace(`${root}/`, ""),
      generated_at: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 });
    console.log(`REPORT_DIR=${reportDir}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
