// TDD contract for protected inventory reconciliation system accounts in isolated L3 only.
import { chownSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const contractPath = join(root,
  "supabase/tests/inventory_reconciliation_system_accounts_contract.sql");
const migrationPath = join(root,
  "supabase/migrations/20260921213000_inventory_reconciliation_system_accounts.sql");
const rollbackPath = join(root,
  "supabase/rollback/20260921213000_inventory_reconciliation_system_accounts.sql");
const marker = "INVENTORY_RECONCILIATION_SYSTEM_ACCOUNTS_CONTRACT_OK";

export function validateSystemAccountsContractSql(sql) {
  for (const required of [
    "BEGIN;", "ROLLBACK;", "current_database() <> 'l3_public_restore'", marker,
    "4201", "5201", "SYSTEM_ACCOUNT_DELETE_FORBIDDEN",
    "trg_guard_system_accounts_delete", "fn_guard_system_accounts_delete",
  ]) {
    if (!sql.includes(required)) throw new Error(`حاجز أو شرط مفقود من عقد حسابات النظام: ${required}`);
  }
  for (let index = 1; index <= 8; index += 1) {
    const label = `Scenario ${String(index).padStart(2, "0")}`;
    if (!sql.includes(label)) throw new Error(`سيناريو حسابات النظام مفقود: ${label}`);
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في عقد حسابات النظام: ${pattern}`);
  }
}

export function validateSystemAccountsMigrationSql(sql) {
  for (const required of [
    "INVENTORY_RECONCILIATION_SYSTEM_ACCOUNTS_BASELINE_MISMATCH",
    "INVENTORY_RECONCILIATION_ACCOUNT_IDENTITY_CONFLICT",
    "SYSTEM:INVENTORY_RECONCILIATION_GAIN:20260921213000",
    "SYSTEM:INVENTORY_RECONCILIATION_LOSS:20260921213000",
    "CREATE FUNCTION public.fn_guard_system_accounts_delete()",
    "CREATE TRIGGER trg_guard_system_accounts_delete",
    "SYSTEM_ACCOUNT_DELETE_FORBIDDEN",
  ]) {
    if (!sql.includes(required)) throw new Error(`جزء مفقود من Migration حسابات النظام: ${required}`);
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في Migration حسابات النظام: ${pattern}`);
  }
}

export function validateSystemAccountsRollbackSql(sql) {
  for (const required of [
    "STAGING_20260921213000",
    "INVENTORY_RECONCILIATION_ACCOUNTS_ROLLBACK_NOT_AUTHORIZED",
    "INVENTORY_RECONCILIATION_ACCOUNTS_ROLLBACK_DEPENDENCY_ACTIVE",
    "INVENTORY_RECONCILIATION_ACCOUNTS_ROLLBACK_HAS_POSTINGS",
    "DROP TRIGGER trg_guard_system_accounts_delete",
    "DROP FUNCTION public.fn_guard_system_accounts_delete()",
  ]) {
    if (!sql.includes(required)) throw new Error(`جزء مفقود من ملف رجوع حسابات النظام: ${required}`);
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
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في ملف رجوع حسابات النظام: ${pattern}`);
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
    "-d", database, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-",
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
  'accounts', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(a)::text, '|' ORDER BY a.id), ''))) FROM public.accounts a),
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
  validateSystemAccountsContractSql(contract);
  const migrationExists = existsSync(migrationPath);
  const rollbackExists = existsSync(rollbackPath);

  if (mode === "--check") {
    if (migrationExists !== rollbackExists) {
      throw new Error("يجب وجود Migration حسابات النظام وملف رجوعها معًا");
    }
    if (migrationExists) {
      validateSystemAccountsMigrationSql(readFileSync(migrationPath, "utf8"));
      validateSystemAccountsRollbackSql(readFileSync(rollbackPath, "utf8"));
    }
    console.log(`تم التحقق من عقد حسابات تسوية المخزون؛ Migration ${migrationExists ? "موجودة" : "غير موجودة"}`);
    return;
  }
  if (mode === "--expect-missing" && (migrationExists || rollbackExists)) {
    throw new Error("ملفات حسابات النظام موجودة بالفعل؛ لم تعد مرحلة TDD الحمراء صالحة");
  }

  if (mode !== "--expect-missing" && (!migrationExists || !rollbackExists)) {
    throw new Error("Migration حسابات النظام أو ملف رجوعها غير موجود");
  }

  assertIsolation(JSON.parse(runDocker(["inspect", container]))[0]);
  const before = psql(businessStateSql);

  if (mode === "--run-migration") {
    const migration = readFileSync(migrationPath, "utf8");
    validateSystemAccountsMigrationSql(migration);
    const contractBody = contract
      .replace(/^\\set ON_ERROR_STOP on\s*/m, "")
      .replace(/^BEGIN;\s*/m, "");
    const reportDir = mkdtempSync("/tmp/accounting-inventory-system-accounts-report-");
    const logPath = join(reportDir, "run.log");
    let output;
    try {
      output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${migration}
${contractBody}`);
    } catch (error) {
      writeDiagnostic(logPath, error.message);
      throw new Error(`فشل اختبار Migration حسابات النظام؛ التشخيص المحمي: ${logPath}`);
    }
    const after = psql(businessStateSql);
    if (!output.includes(marker) || before !== after) {
      throw new Error("فشل عقد حسابات النظام أو تغيرت بيانات L3 بعد ROLLBACK");
    }
    const reportPath = join(reportDir, "report.json");
    writeFileSync(reportPath, `${JSON.stringify({
      status: marker,
      verifiedAt: new Date().toISOString(),
      scenarios: 8,
      container,
      database,
      transactionRolledBack: true,
      isolatedBusinessStatePreserved: true,
      productionOrHostedStagingModified: false,
    }, null, 2)}\n`, { mode: 0o600 });
    console.log("نجحت Migration حسابات تسوية المخزون وحارس الحذف في السيناريوهات الثمانية داخل L3 المعزولة");
    console.log("تم الرجوع عن الحسابات والحارس والعينات بالكامل؛ لم تتغير L3 أو Staging أو الإنتاج");
    console.log(`التقرير: ${reportPath}`);
    return;
  }

  if (mode === "--test-explicit-rollback") {
    const migration = readFileSync(migrationPath, "utf8");
    const rollback = readFileSync(rollbackPath, "utf8");
    validateSystemAccountsMigrationSql(migration);
    validateSystemAccountsRollbackSql(rollback);
    const reportDir = mkdtempSync("/tmp/accounting-inventory-system-accounts-rollback-report-");
    const logPath = join(reportDir, "run.log");
    let output;
    try {
      output = psql(`\\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE system_accounts_before AS
SELECT * FROM public.accounts WHERE code IN ('4201', '5201');
${migration}
SELECT set_config('app.inventory_reconciliation_accounts_rollback_authorized', 'STAGING_20260921213000', true);
${rollback}
DO $verify$
BEGIN
  IF to_regprocedure('public.fn_guard_system_accounts_delete()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.accounts'::regclass
       AND tgname = 'trg_guard_system_accounts_delete' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SYSTEM_ACCOUNTS_EXPLICIT_ROLLBACK_LEFT_GUARD';
  END IF;
  IF (SELECT count(*) FROM public.accounts WHERE code IN ('4201', '5201'))
       <> (SELECT count(*) FROM system_accounts_before)
     OR EXISTS (
       SELECT 1
       FROM system_accounts_before b
       LEFT JOIN public.accounts a ON a.id = b.id
       WHERE a.id IS NULL OR a.code IS DISTINCT FROM b.code
         OR a.name IS DISTINCT FROM b.name
         OR a.account_type IS DISTINCT FROM b.account_type
         OR a.is_parent IS DISTINCT FROM b.is_parent
         OR a.description IS DISTINCT FROM b.description
         OR a.created_at IS DISTINCT FROM b.created_at
     )
     OR EXISTS (
       SELECT 1 FROM public.accounts a JOIN public.accounts p ON p.id = a.parent_id
       WHERE (a.code = '4201' AND (p.code <> '4' OR NOT a.is_system OR NOT a.is_active))
          OR (a.code = '5201' AND (p.code <> '5' OR NOT a.is_system OR NOT a.is_active))
     )
     OR EXISTS (
       SELECT 1 FROM public.accounts
       WHERE description IN (
         'SYSTEM:INVENTORY_RECONCILIATION_GAIN:20260921213000',
         'SYSTEM:INVENTORY_RECONCILIATION_LOSS:20260921213000'
       )
     ) THEN
    RAISE EXCEPTION 'SYSTEM_ACCOUNTS_EXPLICIT_ROLLBACK_INVALID';
  END IF;
END;
$verify$;
SELECT 'INVENTORY_RECONCILIATION_SYSTEM_ACCOUNTS_EXPLICIT_ROLLBACK_OK';
ROLLBACK;`);
    } catch (error) {
      writeDiagnostic(logPath, error.message);
      throw new Error(`فشل اختبار ملف رجوع حسابات النظام؛ التشخيص المحمي: ${logPath}`);
    }
    const after = psql(businessStateSql);
    if (!output.includes("INVENTORY_RECONCILIATION_SYSTEM_ACCOUNTS_EXPLICIT_ROLLBACK_OK")
        || before !== after) {
      throw new Error("فشل تحقق الرجوع الصريح لحسابات النظام أو تغيرت بيانات L3");
    }
    const reportPath = join(reportDir, "report.json");
    writeFileSync(reportPath, `${JSON.stringify({
      status: "INVENTORY_RECONCILIATION_SYSTEM_ACCOUNTS_EXPLICIT_ROLLBACK_OK",
      verifiedAt: new Date().toISOString(),
      container,
      database,
      guardRemoved: true,
      newlyCreatedAccountsRemoved: true,
      preexistingAccountSemanticsPreserved: true,
      preexistingAccountHardeningRetainedUntilOuterRollback: true,
      isolatedBusinessStatePreserved: true,
      productionOrHostedStagingModified: false,
    }, null, 2)}\n`, { mode: 0o600 });
    console.log("نجح اختبار ملف رجوع حسابات تسوية المخزون داخل L3 المعزولة");
    console.log("أزيل الحارس والحساب المنشأ فقط، وحُفظت دلالة الحساب القديم مع تقويته حتى الرجوع الخارجي");
    console.log(`التقرير: ${reportPath}`);
    return;
  }

  const output = psql(`\\set ON_ERROR_STOP on
BEGIN;
DO $red$
BEGIN
  IF to_regprocedure('public.fn_guard_system_accounts_delete()') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.accounts'::regclass
         AND tgname = 'trg_guard_system_accounts_delete'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'SYSTEM_ACCOUNT_DELETE_GUARD_UNEXPECTEDLY_EXISTS';
  END IF;
END;
$red$;
SELECT 'TDD_INVENTORY_RECONCILIATION_SYSTEM_ACCOUNTS_RED_OK';
ROLLBACK;`);
  if (!output.includes("TDD_INVENTORY_RECONCILIATION_SYSTEM_ACCOUNTS_RED_OK")) {
    throw new Error("فشل إثبات TDD الأحمر لحسابات تسوية المخزون");
  }
  console.log("TDD_INVENTORY_RECONCILIATION_SYSTEM_ACCOUNTS_RED_OK: العقد جاهز وحارس حذف حسابات النظام غير موجود كما هو متوقع");
  console.log("لم يُنشأ أو يُحذف أو يُعدّل أي حساب، ولم تتغير L3 أو Staging أو الإنتاج");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
