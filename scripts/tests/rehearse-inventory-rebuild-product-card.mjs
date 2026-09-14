// TDD لمنفذ إعادة بناء بطاقة المنتج داخل حاوية L3 المعزولة فقط.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const contractPath = join(root, "supabase/tests/inventory_reconciliation_rebuild_product_card_contract.sql");
const diagnosticMigrationPath = join(root, "supabase/migrations/20260913160000_inventory_reconciliation_diagnostic.sql");
const lifecycleMigrationPath = join(root, "supabase/migrations/20260913234500_inventory_reconciliation_repair_lifecycle.sql");
const executorMigrationPath = join(root, "supabase/migrations/20260914190000_inventory_reconciliation_rebuild_product_card_executor.sql");
const executorRollbackPath = join(root, "supabase/rollback/20260914190000_inventory_reconciliation_rebuild_product_card_executor.sql");
const marker = "INVENTORY_RECONCILIATION_REBUILD_PRODUCT_CARD_CONTRACT_OK";

export function validateRebuildContractSql(sql) {
  for (const required of [
    "BEGIN;",
    "ROLLBACK;",
    "current_database() <> 'l3_public_restore'",
    marker,
    "REPAIR_PRECONDITION_CHANGED",
    "REPAIR_POSTCHECK_FAILED",
    "product_card_rebuilt",
  ]) {
    if (!sql.includes(required)) throw new Error(`حاجز أو شرط مفقود من عقد 2C: ${required}`);
  }
  for (let index = 1; index <= 10; index += 1) {
    const label = `Scenario ${String(index).padStart(2, "0")}`;
    if (!sql.includes(label)) throw new Error(`سيناريو 2C مفقود: ${label}`);
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في عقد 2C: ${pattern}`);
  }
}

export function validateRebuildMigrationSql(sql) {
  for (const required of [
    "CREATE OR REPLACE FUNCTION public.execute_inventory_reconciliation_repair(",
    "SECURITY DEFINER",
    "pg_advisory_xact_lock",
    "FOR UPDATE",
    "REPAIR_PRECONDITION_CHANGED",
    "REPAIR_POSTCHECK_FAILED",
    "product_card_rebuilt",
    "UPDATE public.products",
    "INSERT INTO public.inventory_reconciliation_repair_effects",
  ]) {
    if (!sql.includes(required)) throw new Error(`جزء مفقود من Migration منفذ 2C: ${required}`);
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(?:inventory_movements|journal_entries|journal_entry_lines)\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في Migration منفذ 2C: ${pattern}`);
  }
}

export function validateRebuildRollbackSql(sql) {
  for (const required of [
    "STAGING_20260914190000",
    "INVENTORY_REBUILD_ROLLBACK_NOT_AUTHORIZED",
    "INVENTORY_REBUILD_ROLLBACK_HAS_EXECUTIONS",
    "CREATE OR REPLACE FUNCTION public.execute_inventory_reconciliation_repair(",
    "REPAIR_TYPE_NOT_ENABLED",
  ]) {
    if (!sql.includes(required)) throw new Error(`جزء مفقود من ملف رجوع 2C: ${required}`);
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bCASCADE\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(?:products|inventory_movements|journal_entries|journal_entry_lines)\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في ملف رجوع 2C: ${pattern}`);
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
  'products', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), ''))) FROM public.products p),
  'inventory_movements', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id), ''))) FROM public.inventory_movements m),
  'purchase_invoices', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), ''))) FROM public.purchase_invoices p),
  'journal_entries', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id), ''))) FROM public.journal_entries j),
  'journal_entry_lines', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), ''))) FROM public.journal_entry_lines l),
  'audit_log', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(a)::text, '|' ORDER BY a.id), ''))) FROM public.audit_log a)
);`;

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!['--check', '--expect-missing', '--run-migration', '--test-explicit-rollback'].includes(mode) || process.argv.length > 3) {
    throw new Error("استخدم --check أو --expect-missing أو --run-migration أو --test-explicit-rollback");
  }

  const contract = readFileSync(contractPath, "utf8");
  const diagnosticMigration = readFileSync(diagnosticMigrationPath, "utf8");
  const lifecycleMigration = readFileSync(lifecycleMigrationPath, "utf8");
  validateRebuildContractSql(contract);

  const migrationExists = existsSync(executorMigrationPath);
  const rollbackExists = existsSync(executorRollbackPath);
  if (mode === "--check") {
    console.log(`تم التحقق من عقد 2C؛ Migration التنفيذ ${migrationExists ? "موجودة" : "غير موجودة"}`);
    return;
  }

  assertIsolation(JSON.parse(runDocker(["inspect", container]))[0]);
  const before = psql(businessStateSql);

  if (mode === "--expect-missing") {
    if (migrationExists || rollbackExists) {
      throw new Error("ملفات منفذ 2C موجودة بالفعل؛ لم تعد مرحلة TDD الحمراء صالحة");
    }
    const output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${diagnosticMigration}
${lifecycleMigration}
DO $red$
BEGIN
  IF position('REPAIR_TYPE_NOT_ENABLED' IN pg_get_functiondef(
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
  )) = 0 THEN
    RAISE EXCEPTION '2C_EXECUTOR_UNEXPECTEDLY_ENABLED';
  END IF;
END;
$red$;
SELECT 'TDD_REBUILD_PRODUCT_CARD_RED_OK';
ROLLBACK;`);
    const after = psql(businessStateSql);
    if (!output.includes("TDD_REBUILD_PRODUCT_CARD_RED_OK") || before !== after) {
      throw new Error("فشل إثبات TDD الأحمر أو تغيرت بيانات L3");
    }
    console.log("TDD_REBUILD_PRODUCT_CARD_RED_OK: عقد 2C جاهز والمنفذ ما زال محجوبًا كما هو متوقع");
    console.log("لم تُنفذ بيانات اختبار ولم تتغير L3 أو Staging أو أي قاعدة إنتاجية");
    return;
  }

  if (!migrationExists || !rollbackExists) {
    throw new Error("Migration أو ملف رجوع منفذ 2C غير موجود");
  }
  const executorMigration = readFileSync(executorMigrationPath, "utf8");
  const executorRollback = readFileSync(executorRollbackPath, "utf8");
  validateRebuildMigrationSql(executorMigration);
  validateRebuildRollbackSql(executorRollback);
  if (mode === "--test-explicit-rollback") {
    const reportDir = mkdtempSync("/tmp/accounting-inventory-rebuild-product-card-rollback-report-");
    const logPath = join(reportDir, "run.log");
    let output;
    try {
      output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${diagnosticMigration}
${lifecycleMigration}
${executorMigration}
SELECT set_config('app.inventory_rebuild_rollback_authorized', 'STAGING_20260914190000', true);
${executorRollback}
DO $verify_rollback$
BEGIN
  IF position('REPAIR_TYPE_NOT_ENABLED' IN pg_get_functiondef(
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
  )) = 0 OR position('product_card_rebuilt' IN pg_get_functiondef(
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
  )) > 0 THEN
    RAISE EXCEPTION 'INVENTORY_REBUILD_EXPLICIT_ROLLBACK_FAILED';
  END IF;
  IF to_regclass('public.inventory_reconciliation_repairs') IS NULL
     OR to_regclass('public.inventory_reconciliation_repair_items') IS NULL
     OR to_regclass('public.inventory_reconciliation_repair_effects') IS NULL
     OR to_regclass('public.inventory_reconciliation_repair_events') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_REBUILD_ROLLBACK_REMOVED_LIFECYCLE';
  END IF;
END;
$verify_rollback$;
SELECT 'INVENTORY_REBUILD_EXPLICIT_ROLLBACK_OK';
ROLLBACK;`);
    } catch (error) {
      writeFileSync(logPath, `${error.message}\n`, { mode: 0o600 });
      throw new Error(`فشل اختبار ملف رجوع 2C؛ التشخيص المحمي: ${logPath}`);
    }
    const afterRollbackTest = psql(businessStateSql);
    if (!output.includes("INVENTORY_REBUILD_EXPLICIT_ROLLBACK_OK")) {
      throw new Error("لم تظهر علامة نجاح ملف رجوع 2C");
    }
    if (before !== afterRollbackTest) {
      throw new Error("تغيرت بيانات أعمال L3 بعد اختبار ملف الرجوع رغم ROLLBACK");
    }
    const reportPath = join(reportDir, "report.json");
    writeFileSync(reportPath, `${JSON.stringify({
      status: "INVENTORY_REBUILD_EXPLICIT_ROLLBACK_OK",
      verifiedAt: new Date().toISOString(),
      container,
      database,
      migration: executorMigrationPath,
      rollback: executorRollbackPath,
      lifecycleObjectsPreserved: true,
      stage2BGuardRestored: true,
      migrationRolledBack: true,
      isolatedBusinessStatePreserved: true,
      productionOrHostedStagingModified: false,
    }, null, 2)}\n`, { mode: 0o600 });
    console.log("نجح اختبار ملف رجوع 2C داخل L3 المعزولة");
    console.log("عاد منفذ 2B المحجوب وبقيت جداول الدورة وبيانات الأعمال كما هي");
    console.log(`التقرير: ${reportPath}`);
    return;
  }
  const contractBody = contract
    .replace(/^\\set ON_ERROR_STOP on\s*/m, "")
    .replace(/^BEGIN;\s*/m, "");
  const reportDir = mkdtempSync("/tmp/accounting-inventory-rebuild-product-card-report-");
  const logPath = join(reportDir, "run.log");
  let output;
  try {
    output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${diagnosticMigration}
${lifecycleMigration}
${executorMigration}
${contractBody}`);
  } catch (error) {
    writeFileSync(logPath, `${error.message}\n`, { mode: 0o600 });
    throw new Error(`فشل اختبار منفذ 2C؛ التشخيص المحمي: ${logPath}`);
  }
  const after = psql(businessStateSql);
  if (!output.includes(marker)) throw new Error("لم تظهر علامة نجاح عقد منفذ 2C");
  if (before !== after) throw new Error("تغيرت بيانات أعمال L3 بعد اختبار 2C رغم ROLLBACK");

  const reportPath = join(reportDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify({
    status: "INVENTORY_RECONCILIATION_REBUILD_PRODUCT_CARD_MIGRATION_OK",
    verifiedAt: new Date().toISOString(),
    container,
    database,
    migration: executorMigrationPath,
    rollback: executorRollbackPath,
    scenarios: 10,
    migrationRolledBack: true,
    isolatedBusinessStatePreserved: true,
    productionOrHostedStagingModified: false,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجحت Migration منفذ إعادة بناء البطاقة في السيناريوهات العشرة داخل L3 المعزولة");
  console.log("تم الرجوع عن Migration والعينات بالكامل؛ لم تتغير L3 أو Staging أو الإنتاج");
  console.log(`التقرير: ${reportPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
