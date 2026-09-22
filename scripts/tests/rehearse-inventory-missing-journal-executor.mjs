// TDD الأحمر لمنفذ 2D-B داخل حاوية L3 المعزولة فقط.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const contractPath = join(root,
  "supabase/tests/inventory_reconciliation_missing_journal_executor_contract.sql");
const diagnosticMigrationPath = join(root,
  "supabase/migrations/20260913160000_inventory_reconciliation_diagnostic.sql");
const lifecycleMigrationPath = join(root,
  "supabase/migrations/20260913234500_inventory_reconciliation_repair_lifecycle.sql");
const rebuildMigrationPath = join(root,
  "supabase/migrations/20260914190000_inventory_reconciliation_rebuild_product_card_executor.sql");
const plannerMigrationPath = join(root,
  "supabase/migrations/20260921220000_inventory_reconciliation_missing_journal_plan.sql");
const executorMigrationPath = join(root,
  "supabase/migrations/20260921233000_inventory_reconciliation_missing_journal_executor.sql");
const executorRollbackPath = join(root,
  "supabase/rollback/20260921233000_inventory_reconciliation_missing_journal_executor.sql");
const marker = "INVENTORY_RECONCILIATION_MISSING_JOURNAL_EXECUTOR_CONTRACT_OK";

export function validateExecutorContractSql(sql) {
  for (const required of [
    "BEGIN;", "ROLLBACK;", "current_database() <> 'l3_public_restore'", marker,
    "REPAIR_PRECONDITION_CHANGED", "missing_inventory_journal_created",
    "create_missing_inventory_journal", "NO_CORRECTION_REQUIRED",
  ]) {
    if (!sql.includes(required)) throw new Error(`حاجز أو شرط مفقود من عقد 2D-B: ${required}`);
  }
  for (let index = 1; index <= 14; index += 1) {
    const label = `Scenario ${String(index).padStart(2, "0")}`;
    if (!sql.includes(label)) throw new Error(`سيناريو 2D-B مفقود: ${label}`);
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في عقد 2D-B: ${pattern}`);
  }
}

export function validateExecutorMigrationSql(sql) {
  for (const required of [
    "INVENTORY_MISSING_JOURNAL_EXECUTOR_BASELINE_MISMATCH",
    "get_inventory_reconciliation_journal_plan_base_2da",
    "execute_inventory_reconciliation_repair_rebuild_2c",
    "SECURITY DEFINER",
    "FOR UPDATE",
    "REPAIR_PRECONDITION_CHANGED",
    "REPAIR_POSTCHECK_FAILED",
    "missing_inventory_journal_created",
    "create_missing_inventory_journal",
    "public.create_journal_entry",
    "NO_CORRECTION_REQUIRED",
  ]) {
    if (!sql.includes(required)) throw new Error(`جزء مفقود من Migration منفذ 2D-B: ${required}`);
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /\b(?:UPDATE|DELETE\s+FROM)\s+public\.(?:products|inventory_movements|journal_entries|journal_entry_lines)\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في Migration منفذ 2D-B: ${pattern}`);
  }
}

export function validateExecutorRollbackSql(sql) {
  for (const required of [
    "STAGING_20260921233000",
    "INVENTORY_MISSING_JOURNAL_EXECUTOR_ROLLBACK_NOT_AUTHORIZED",
    "INVENTORY_MISSING_JOURNAL_EXECUTOR_ROLLBACK_HAS_EXECUTIONS",
    "execute_inventory_reconciliation_repair_rebuild_2c",
    "get_inventory_reconciliation_journal_plan_base_2da",
  ]) {
    if (!sql.includes(required)) throw new Error(`جزء مفقود من ملف رجوع 2D-B: ${required}`);
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
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في ملف رجوع 2D-B: ${pattern}`);
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
  'sales_invoices', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), ''))) FROM public.sales_invoices s),
  'purchase_invoices', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), ''))) FROM public.purchase_invoices p),
  'journal_entries', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id), ''))) FROM public.journal_entries j),
  'journal_entry_lines', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), ''))) FROM public.journal_entry_lines l)
);`;

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--expect-missing", "--run-migration", "--test-explicit-rollback"].includes(mode)
      || process.argv.length > 3) {
    throw new Error("استخدم --check أو --expect-missing أو --run-migration أو --test-explicit-rollback");
  }

  const contract = readFileSync(contractPath, "utf8");
  validateExecutorContractSql(contract);
  const migrationExists = existsSync(executorMigrationPath);
  const rollbackExists = existsSync(executorRollbackPath);

  if (mode === "--check") {
    if (migrationExists !== rollbackExists) {
      throw new Error("يجب وجود Migration منفذ 2D-B وملف رجوعها معًا");
    }
    if (migrationExists) {
      validateExecutorMigrationSql(readFileSync(executorMigrationPath, "utf8"));
      validateExecutorRollbackSql(readFileSync(executorRollbackPath, "utf8"));
    }
    console.log(`تم التحقق من عقد منفذ 2D-B؛ Migration التنفيذ ${migrationExists ? "موجودة" : "غير موجودة"}`);
    return;
  }
  if (mode === "--expect-missing" && (migrationExists || rollbackExists)) {
    throw new Error("ملفات منفذ 2D-B موجودة بالفعل؛ لم تعد مرحلة TDD الحمراء صالحة");
  }

  if (mode !== "--expect-missing" && (!migrationExists || !rollbackExists)) {
    throw new Error("Migration منفذ 2D-B أو ملف رجوعها غير موجود");
  }

  assertIsolation(JSON.parse(runDocker(["inspect", container]))[0]);
  const before = psql(businessStateSql);
  const diagnosticMigration = readFileSync(diagnosticMigrationPath, "utf8");
  const lifecycleMigration = readFileSync(lifecycleMigrationPath, "utf8");
  const rebuildMigration = readFileSync(rebuildMigrationPath, "utf8");
  const plannerMigration = readFileSync(plannerMigrationPath, "utf8");

  if (mode === "--test-explicit-rollback") {
    const executorMigration = readFileSync(executorMigrationPath, "utf8");
    const executorRollback = readFileSync(executorRollbackPath, "utf8");
    validateExecutorMigrationSql(executorMigration);
    validateExecutorRollbackSql(executorRollback);
    const reportDir = mkdtempSync("/tmp/accounting-inventory-missing-journal-executor-rollback-report-");
    const logPath = join(reportDir, "run.log");
    let output;
    try {
      output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${diagnosticMigration}
${lifecycleMigration}
${rebuildMigration}
${plannerMigration}
${executorMigration}
SELECT set_config('app.inventory_missing_journal_executor_rollback_authorized', 'STAGING_20260921233000', true);
${executorRollback}
DO $verify$
BEGIN
  IF to_regprocedure('public.execute_inventory_reconciliation_repair_rebuild_2c(uuid,integer,uuid)') IS NOT NULL
     OR to_regprocedure('public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)') IS NOT NULL THEN
    RAISE EXCEPTION '2DB_EXPLICIT_ROLLBACK_LEFT_INTERNAL_FUNCTIONS';
  END IF;
  IF position('product_card_rebuilt' IN pg_get_functiondef(
      'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure)) = 0
     OR position('missing_inventory_journal_created' IN pg_get_functiondef(
      'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION '2DB_EXPLICIT_ROLLBACK_DID_NOT_RESTORE_2C';
  END IF;
END;
$verify$;
SELECT 'INVENTORY_MISSING_JOURNAL_EXECUTOR_EXPLICIT_ROLLBACK_OK';
ROLLBACK;`);
    } catch (error) {
      writeFileSync(logPath, `${error.message}\n`, { mode: 0o600 });
      throw new Error(`فشل اختبار ملف رجوع منفذ 2D-B؛ التشخيص المحمي: ${logPath}`);
    }
    const after = psql(businessStateSql);
    if (!output.includes("INVENTORY_MISSING_JOURNAL_EXECUTOR_EXPLICIT_ROLLBACK_OK") || before !== after) {
      throw new Error("فشل تحقق الرجوع الصريح لمنفذ 2D-B أو تغيرت بيانات L3");
    }
    const reportPath = join(reportDir, "report.json");
    writeFileSync(reportPath, `${JSON.stringify({
      status: "INVENTORY_MISSING_JOURNAL_EXECUTOR_EXPLICIT_ROLLBACK_OK",
      verifiedAt: new Date().toISOString(),
      container,
      database,
      stage2CExecutorRestored: true,
      stage2APlannerRestored: true,
      isolatedBusinessStatePreserved: true,
      productionOrHostedStagingModified: false,
    }, null, 2)}\n`, { mode: 0o600 });
    console.log("نجح اختبار ملف رجوع منفذ 2D-B داخل L3 المعزولة");
    console.log("عاد منفذ 2C ومخطط 2D-A وبقيت بيانات الأعمال كما هي");
    console.log(`التقرير: ${reportPath}`);
    return;
  }

  if (mode === "--run-migration") {
    const executorMigration = readFileSync(executorMigrationPath, "utf8");
    validateExecutorMigrationSql(executorMigration);
    const contractBody = contract
      .replace(/^\\set ON_ERROR_STOP on\s*/m, "")
      .replace(/^BEGIN;\s*/m, "");
    const reportDir = mkdtempSync("/tmp/accounting-inventory-missing-journal-executor-report-");
    const logPath = join(reportDir, "run.log");
    let output;
    try {
      output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${diagnosticMigration}
${lifecycleMigration}
${rebuildMigration}
${plannerMigration}
${executorMigration}
${contractBody}`);
    } catch (error) {
      writeFileSync(logPath, `${error.message}\n`, { mode: 0o600 });
      throw new Error(`فشل اختبار Migration منفذ 2D-B؛ التشخيص المحمي: ${logPath}`);
    }
    const after = psql(businessStateSql);
    if (!output.includes(marker) || before !== after) {
      throw new Error("فشل عقد منفذ 2D-B أو تغيرت بيانات L3 بعد ROLLBACK");
    }
    const reportPath = join(reportDir, "report.json");
    writeFileSync(reportPath, `${JSON.stringify({
      status: marker,
      verifiedAt: new Date().toISOString(),
      scenarios: 14,
      container,
      database,
      transactionRolledBack: true,
      isolatedBusinessStatePreserved: true,
      productionOrHostedStagingModified: false,
    }, null, 2)}\n`, { mode: 0o600 });
    console.log("نجحت Migration منفذ 2D-B في السيناريوهات الأربعة عشر داخل L3 المعزولة");
    console.log("تم الرجوع عن المنفذ والعينات بالكامل؛ لم تتغير L3 أو Staging أو الإنتاج");
    console.log(`التقرير: ${reportPath}`);
    return;
  }

  const output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${diagnosticMigration}
${lifecycleMigration}
${rebuildMigration}
${plannerMigration}
DO $red$
BEGIN
  IF position('missing_inventory_journal_created' IN pg_get_functiondef(
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
  )) > 0 THEN
    RAISE EXCEPTION '2DB_EXECUTOR_UNEXPECTEDLY_ENABLED';
  END IF;
  IF position('REPAIR_TYPE_NOT_ENABLED' IN pg_get_functiondef(
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
  )) = 0 THEN
    RAISE EXCEPTION '2DB_EXECUTOR_GUARD_MISSING';
  END IF;
END;
$red$;
SELECT 'TDD_MISSING_INVENTORY_JOURNAL_EXECUTOR_RED_OK';
ROLLBACK;`);
  const after = psql(businessStateSql);
  if (!output.includes("TDD_MISSING_INVENTORY_JOURNAL_EXECUTOR_RED_OK") || before !== after) {
    throw new Error("فشل إثبات TDD الأحمر لمنفذ 2D-B أو تغيرت بيانات L3");
  }
  console.log("TDD_MISSING_INVENTORY_JOURNAL_EXECUTOR_RED_OK: عقد 2D-B جاهز والمنفذ ما زال محجوبًا");
  console.log("لم تُنفذ سيناريوهات العقد ولم تتغير L3 أو Staging أو أي قاعدة إنتاجية");
}

main();
