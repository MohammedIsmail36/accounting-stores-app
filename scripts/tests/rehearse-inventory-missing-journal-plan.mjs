// TDD الأحمر لمخطط 2D داخل حاوية L3 المعزولة فقط.
import { chownSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const systemAccountsMigrationPath = join(
  root,
  "supabase/migrations/20260921213000_inventory_reconciliation_system_accounts.sql",
);
const contractPath = join(
  root,
  "supabase/tests/inventory_reconciliation_missing_journal_plan_contract.sql",
);
const migrationPath = join(
  root,
  "supabase/migrations/20260921220000_inventory_reconciliation_missing_journal_plan.sql",
);
const rollbackPath = join(
  root,
  "supabase/rollback/20260921220000_inventory_reconciliation_missing_journal_plan.sql",
);
const plannerSignature = "public.get_inventory_reconciliation_journal_plan(text,uuid,date)";

export function validateMissingJournalPlanContract(sql) {
  for (const required of [
    "BEGIN;",
    "ROLLBACK;",
    "current_database() <> 'l3_public_restore'",
    "INVENTORY_RECONCILIATION_MISSING_JOURNAL_PLAN_CONTRACT_OK",
    "create_full_journal",
    "post_delta_journal",
    "JOURNAL_DRAFT_REQUIRES_REVIEW",
    "UNEXPECTED_ACCOUNT_DELTA",
    "ACCOUNTING_DATE_REQUIRED",
    "plan_fingerprint",
    "5108",
    "5201",
    "4201",
  ]) {
    if (!sql.includes(required)) {
      throw new Error(`حاجز أو شرط مفقود من عقد مخطط 2D: ${required}`);
    }
  }
  for (let index = 1; index <= 18; index += 1) {
    const label = `Scenario ${String(index).padStart(2, "0")}`;
    if (!sql.includes(label)) throw new Error(`سيناريو 2D مفقود: ${label}`);
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
      throw new Error(`عبارة غير مسموحة في عقد مخطط 2D: ${pattern}`);
    }
  }
}

export function validateMissingJournalPlanMigration(sql) {
  for (const required of [
    "CREATE OR REPLACE FUNCTION public.get_inventory_reconciliation_journal_plan(",
    "STABLE",
    "SECURITY DEFINER",
    "create_full_journal",
    "post_delta_journal",
    "JOURNAL_DRAFT_REQUIRES_REVIEW",
    "UNEXPECTED_ACCOUNT_DELTA",
    "ACCOUNTING_DATE_REQUIRED",
    "plan_fingerprint",
    "invalid_account_codes",
    "REVOKE ALL ON FUNCTION",
  ]) {
    if (!sql.includes(required)) {
      throw new Error(`جزء مفقود من Migration مخطط 2D: ${required}`);
    }
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(?:products|inventory_movements|sales_invoices|purchase_invoices|sales_returns|purchase_returns|inventory_adjustments|journal_entries|journal_entry_lines|inventory_reconciliation_repairs)\b/i,
    /public\.create_journal_entry\s*\(/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) {
      throw new Error(`عبارة كتابة أو اتصال غير مسموحة في Migration مخطط 2D: ${pattern}`);
    }
  }
}

export function validateMissingJournalPlanRollback(sql) {
  for (const required of [
    "STAGING_20260921220000",
    "INVENTORY_MISSING_JOURNAL_PLAN_ROLLBACK_NOT_AUTHORIZED",
    "DROP FUNCTION public.get_inventory_reconciliation_journal_plan(text, uuid, date)",
  ]) {
    if (!sql.includes(required)) {
      throw new Error(`جزء مفقود من ملف رجوع مخطط 2D: ${required}`);
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
      throw new Error(`عبارة غير مسموحة في ملف رجوع مخطط 2D: ${pattern}`);
    }
  }
}

function runDocker(args, input) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(result.stderr?.trim() || result.error?.message || "فشل فحص L3");
  }
  return result.stdout.trim();
}

function psql(query) {
  return runDocker([
    "exec", "-i", container, "psql", "-h", "/tmp", "-U", "postgres",
    "-d", database, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
    "-f", "-",
  ], query);
}

function writeDiagnostic(path, message) {
  writeFileSync(path, `${message}\n`, { mode: 0o600 });
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  if (Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) {
    chownSync(path, uid, gid);
  }
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
  'sales_returns', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), ''))) FROM public.sales_returns s),
  'purchase_returns', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), ''))) FROM public.purchase_returns p),
  'inventory_adjustments', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(a)::text, '|' ORDER BY a.id), ''))) FROM public.inventory_adjustments a),
  'journal_entries', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id), ''))) FROM public.journal_entries j),
  'journal_entry_lines', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), ''))) FROM public.journal_entry_lines l)
);`;

function main() {
  const mode = process.argv[2] ?? "--check";
  if (
    !["--check", "--expect-missing", "--run-migration", "--test-explicit-rollback"].includes(mode)
    || process.argv.length > 3
  ) {
    throw new Error("استخدم --check أو --expect-missing أو --run-migration أو --test-explicit-rollback");
  }

  const contract = readFileSync(contractPath, "utf8");
  validateMissingJournalPlanContract(contract);
  const migrationExists = existsSync(migrationPath);
  const rollbackExists = existsSync(rollbackPath);

  if (mode === "--check") {
    if (migrationExists !== rollbackExists) {
      throw new Error("يجب وجود Migration مخطط 2D وملف رجوعها معًا");
    }
    if (migrationExists) {
      validateMissingJournalPlanMigration(readFileSync(migrationPath, "utf8"));
      validateMissingJournalPlanRollback(readFileSync(rollbackPath, "utf8"));
    }
    console.log(
      `تم التحقق من عقد مخطط 2D؛ Migration المخطط ${migrationExists ? "موجودة" : "غير موجودة"}`,
    );
    return;
  }

  assertIsolation(JSON.parse(runDocker(["inspect", container]))[0]);
  const before = psql(businessStateSql);
  if (mode === "--expect-missing") {
    if (migrationExists || rollbackExists) {
      throw new Error("ملفات مخطط 2D موجودة بالفعل؛ لم تعد مرحلة TDD الحمراء صالحة");
    }
    const output = psql(`\\set ON_ERROR_STOP on
BEGIN;
DO $red$
DECLARE v_executor text; v_executor_oid regprocedure;
BEGIN
  IF to_regprocedure('${plannerSignature}') IS NOT NULL THEN
    RAISE EXCEPTION '2D_PLANNER_UNEXPECTEDLY_EXISTS';
  END IF;
  v_executor_oid := to_regprocedure(
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'
  );
  IF v_executor_oid IS NOT NULL THEN
    SELECT pg_get_functiondef(v_executor_oid) INTO v_executor;
    IF position('corrective_inventory_journal_created' IN v_executor) > 0 THEN
      RAISE EXCEPTION '2D_EXECUTOR_UNEXPECTEDLY_ENABLED';
    END IF;
  END IF;
END;
$red$;
SELECT 'TDD_MISSING_INVENTORY_JOURNAL_PLAN_RED_OK';
ROLLBACK;`);
    const after = psql(businessStateSql);

    if (!output.includes("TDD_MISSING_INVENTORY_JOURNAL_PLAN_RED_OK") || before !== after) {
      throw new Error("فشل إثبات TDD الأحمر لمخطط 2D أو تغيرت بيانات L3");
    }

    console.log("TDD_MISSING_INVENTORY_JOURNAL_PLAN_RED_OK: عقد 2D جاهز والمخطط والمنفذ ما زالا محجوبين");
    console.log("لم تُنفذ بيانات العقد ولم تتغير L3 أو Staging أو أي قاعدة إنتاجية");
    return;
  }

  if (!migrationExists || !rollbackExists) {
    throw new Error("Migration أو ملف رجوع مخطط 2D غير موجود");
  }
  const migration = readFileSync(migrationPath, "utf8");
  const systemAccountsMigration = readFileSync(systemAccountsMigrationPath, "utf8");
  const rollback = readFileSync(rollbackPath, "utf8");
  validateMissingJournalPlanMigration(migration);
  validateMissingJournalPlanRollback(rollback);

  if (mode === "--test-explicit-rollback") {
    const reportDir = mkdtempSync("/tmp/accounting-inventory-missing-journal-plan-rollback-report-");
    const logPath = join(reportDir, "run.log");
    let output;
    try {
      output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${systemAccountsMigration}
${migration}
SELECT set_config(
  'app.inventory_missing_journal_plan_rollback_authorized',
  'STAGING_20260921220000', true
);
${rollback}
DO $verify$
BEGIN
  IF to_regprocedure('${plannerSignature}') IS NOT NULL THEN
    RAISE EXCEPTION '2D_PLAN_EXPLICIT_ROLLBACK_FAILED';
  END IF;
END;
$verify$;
SELECT 'INVENTORY_MISSING_JOURNAL_PLAN_EXPLICIT_ROLLBACK_OK';
ROLLBACK;`);
    } catch (error) {
      writeDiagnostic(logPath, error.message);
      throw new Error(`فشل اختبار ملف رجوع مخطط 2D؛ التشخيص المحمي: ${logPath}`);
    }
    const after = psql(businessStateSql);
    if (!output.includes("INVENTORY_MISSING_JOURNAL_PLAN_EXPLICIT_ROLLBACK_OK") || before !== after) {
      throw new Error("فشل تحقق الرجوع الصريح لمخطط 2D أو تغيرت بيانات L3");
    }
    const reportPath = join(reportDir, "report.json");
    writeFileSync(reportPath, `${JSON.stringify({
      status: "INVENTORY_MISSING_JOURNAL_PLAN_EXPLICIT_ROLLBACK_OK",
      verifiedAt: new Date().toISOString(),
      container,
      database,
      migration: migrationPath,
      rollback: rollbackPath,
      migrationRolledBack: true,
      isolatedBusinessStatePreserved: true,
      productionOrHostedStagingModified: false,
    }, null, 2)}\n`, { mode: 0o600 });
    console.log("نجح اختبار ملف رجوع مخطط 2D داخل L3 المعزولة");
    console.log("أزيلت دالة القراءة فقط وبقيت بيانات الأعمال كما هي");
    console.log(`التقرير: ${reportPath}`);
    return;
  }

  const contractBody = contract
    .replace(/^\\set ON_ERROR_STOP on\s*/m, "")
    .replace(/^BEGIN;\s*/m, "");
  const reportDir = mkdtempSync("/tmp/accounting-inventory-missing-journal-plan-report-");
  const logPath = join(reportDir, "run.log");
  let output;
  try {
    output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${systemAccountsMigration}
${migration}
${contractBody}`);
  } catch (error) {
    writeDiagnostic(logPath, error.message);
    throw new Error(`فشل اختبار Migration مخطط 2D؛ التشخيص المحمي: ${logPath}`);
  }
  const after = psql(businessStateSql);
  if (!output.includes("INVENTORY_RECONCILIATION_MISSING_JOURNAL_PLAN_CONTRACT_OK")) {
    throw new Error("لم تظهر علامة نجاح عقد مخطط 2D");
  }
  if (before !== after) {
    throw new Error("تغيرت بيانات أعمال L3 بعد اختبار مخطط 2D رغم ROLLBACK");
  }
  const reportPath = join(reportDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify({
    status: "INVENTORY_RECONCILIATION_MISSING_JOURNAL_PLAN_MIGRATION_OK",
    verifiedAt: new Date().toISOString(),
    container,
    database,
    migration: migrationPath,
    rollback: rollbackPath,
    scenarios: 18,
    plannerReadOnly: true,
    migrationRolledBack: true,
    isolatedBusinessStatePreserved: true,
    productionOrHostedStagingModified: false,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجحت Migration مخطط 2D للقراءة فقط في السيناريوهات الثمانية عشر داخل L3 المعزولة");
  console.log("تم الرجوع عن الدالة والعينات بالكامل؛ لم تتغير L3 أو Staging أو الإنتاج");
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
