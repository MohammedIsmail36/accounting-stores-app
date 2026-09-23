// TDD contract for numeric posted journal numbering inside isolated L3 only.
import { chownSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const contractPath = join(root, "supabase/tests/journal_posted_number_invariant_contract.sql");
const migrationPath = join(root, "supabase/migrations/20260923030000_journal_posted_number_invariant.sql");
const rollbackPath = join(root, "supabase/rollback/20260923030000_journal_posted_number_invariant.sql");
const marker = "JOURNAL_POSTED_NUMBER_INVARIANT_CONTRACT_OK";

export function validateJournalPostedNumberContract(sql) {
  for (const required of [
    "BEGIN;", "ROLLBACK;", "current_database() <> 'l3_public_restore'", marker,
    "journal_entries_posted_number_required", "journal_entries_posted_number_unique",
    "pg_advisory_xact_lock", "journal_entries.posted_number",
    "create_journal_entry", "replace_journal_entry_lines",
    "journal_posted_number_legacy_fixture",
  ]) {
    if (!sql.includes(required)) throw new Error(`حاجز أو شرط مفقود من عقد ترقيم القيود: ${required}`);
  }
  for (let index = 1; index <= 8; index += 1) {
    const label = `Scenario ${String(index).padStart(2, "0")}`;
    if (!sql.includes(label)) throw new Error(`سيناريو ترقيم القيود مفقود: ${label}`);
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في عقد ترقيم القيود: ${pattern}`);
  }
}

export function validateJournalPostedNumberMigration(sql) {
  for (const required of [
    "BEGIN;",
    "COMMIT;",
    "JOURNAL_POSTED_NUMBER_BASELINE_MISMATCH",
    "JOURNAL_POSTED_NUMBER_DUPLICATES_EXIST",
    "JOURNAL_POSTED_NUMBER_GUARDS_ALREADY_EXIST",
    "pg_advisory_xact_lock(hashtext('journal_entries.posted_number'))",
    "journal_entries_posted_number_unique",
    "journal_entries_posted_number_required",
    "row_number() OVER (ORDER BY entry_number, id)",
    "CREATE OR REPLACE FUNCTION public.create_journal_entry",
    "CREATE OR REPLACE FUNCTION public.replace_journal_entry_lines",
  ]) {
    if (!sql.includes(required)) throw new Error(`جزء مفقود من Migration ترقيم القيود: ${required}`);
  }
  for (const pattern of [
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
    /JV-/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في Migration ترقيم القيود: ${pattern}`);
  }
  if (!/^\s*(?:--[^\n]*\n\s*)*BEGIN;/.test(sql)
      || !/COMMIT;\s*$/.test(sql)
      || (sql.match(/\bCOMMIT\s*;/g) ?? []).length !== 1) {
    throw new Error("Migration ترقيم القيود يجب أن تحتوي غلاف معاملة واحدًا صريحًا");
  }
}

export function validateJournalPostedNumberRollback(sql) {
  for (const required of [
    "BEGIN;",
    "COMMIT;",
    "STAGING_20260923030000",
    "JOURNAL_POSTED_NUMBER_ROLLBACK_NOT_AUTHORIZED",
    "JOURNAL_POSTED_NUMBER_ROLLBACK_BASELINE_MISMATCH",
    "DROP CONSTRAINT journal_entries_posted_number_required",
    "DROP INDEX public.journal_entries_posted_number_unique",
    "CREATE OR REPLACE FUNCTION public.create_journal_entry",
    "CREATE OR REPLACE FUNCTION public.replace_journal_entry_lines",
  ]) {
    if (!sql.includes(required)) throw new Error(`جزء مفقود من ملف رجوع ترقيم القيود: ${required}`);
  }
  for (const pattern of [
    /\bCASCADE\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /SET\s+posted_number\s*=\s*NULL/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
    /JV-/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في ملف رجوع ترقيم القيود: ${pattern}`);
  }
  if (!/^\s*(?:--[^\n]*\n\s*)*BEGIN;/.test(sql)
      || !/COMMIT;\s*$/.test(sql)
      || (sql.match(/\bCOMMIT\s*;/g) ?? []).length !== 1) {
    throw new Error("ملف رجوع ترقيم القيود يجب أن يحتوي غلاف معاملة واحدًا صريحًا");
  }
}

export function transactionBody(sql) {
  const withoutBegin = sql.replace(/^(\s*(?:--[^\n]*\n\s*)*)BEGIN;\s*/, "$1");
  const body = withoutBegin.replace(/\s*COMMIT;\s*$/, "\n");
  if (body === sql || /\bCOMMIT\s*;\s*$/.test(body)) {
    throw new Error("تعذر فصل غلاف المعاملة من SQL");
  }
  return body;
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
  'journal_entries', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id), ''))) FROM public.journal_entries j),
  'journal_entry_lines', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), ''))) FROM public.journal_entry_lines l)
);`;

const legacyFixtureSql = `
CREATE TEMP TABLE journal_posted_number_legacy_fixture (
  id uuid PRIMARY KEY,
  entry_number integer NOT NULL,
  previous_max integer NOT NULL
) ON COMMIT DROP;
DO $fixture$
DECLARE
  v_cash uuid;
  v_equity uuid;
  v_previous_max integer;
  v_entry uuid;
  v_offset integer;
BEGIN
  SELECT id INTO STRICT v_cash FROM public.accounts WHERE code = '1101';
  SELECT id INTO STRICT v_equity FROM public.accounts WHERE code = '3101';
  SELECT COALESCE(max(posted_number), 0) INTO v_previous_max FROM public.journal_entries;
  FOR v_offset IN 1..3 LOOP
    v_entry := public.create_journal_entry(
      current_date,
      '__POSTED_NUMBER_LEGACY_' || v_offset::text || '__',
      jsonb_build_array(
        jsonb_build_object('account_id', v_cash, 'debit', 10 + v_offset, 'credit', 0),
        jsonb_build_object('account_id', v_equity, 'debit', 0, 'credit', 10 + v_offset)
      ),
      'posted', NULL, 'regular'
    );
    INSERT INTO pg_temp.journal_posted_number_legacy_fixture(id, entry_number, previous_max)
    SELECT id, entry_number, v_previous_max
    FROM public.journal_entries
    WHERE id = v_entry;
  END LOOP;
END;
$fixture$;`;

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--expect-missing", "--run-migration", "--test-explicit-rollback"].includes(mode)
      || process.argv.length > 3) {
    throw new Error("استخدم --check أو --expect-missing أو --run-migration أو --test-explicit-rollback");
  }
  const contract = readFileSync(contractPath, "utf8");
  validateJournalPostedNumberContract(contract);
  const migrationExists = existsSync(migrationPath);
  const rollbackExists = existsSync(rollbackPath);
  if (migrationExists !== rollbackExists) {
    throw new Error("يجب وجود Migration ترقيم القيود وملف رجوعها معًا");
  }
  if (mode === "--check") {
    if (migrationExists) {
      validateJournalPostedNumberMigration(readFileSync(migrationPath, "utf8"));
      validateJournalPostedNumberRollback(readFileSync(rollbackPath, "utf8"));
    }
    console.log(`تم التحقق من عقد ترقيم القيود؛ Migration ${migrationExists ? "موجودة" : "غير موجودة"}`);
    return;
  }
  if (mode === "--expect-missing" && (migrationExists || rollbackExists)) {
    throw new Error("ملفات ترقيم القيود موجودة بالفعل؛ لم تعد مرحلة TDD الحمراء صالحة");
  }

  if (mode !== "--expect-missing" && (!migrationExists || !rollbackExists)) {
    throw new Error("Migration ترقيم القيود أو ملف رجوعها غير موجود");
  }

  assertIsolation(JSON.parse(runDocker(["inspect", container]))[0]);
  const before = psql(businessStateSql);

  if (mode === "--run-migration") {
    const migration = readFileSync(migrationPath, "utf8");
    validateJournalPostedNumberMigration(migration);
    const contractBody = contract
      .replace(/^\\set ON_ERROR_STOP on\s*/m, "")
      .replace(/^BEGIN;\s*/m, "");
    const reportDir = mkdtempSync("/tmp/accounting-journal-posted-number-report-");
    const logPath = join(reportDir, "run.log");
    let output;
    try {
      output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${legacyFixtureSql}
${transactionBody(migration)}
${contractBody}`);
    } catch (error) {
      writeDiagnostic(logPath, error.message);
      throw new Error(`فشل اختبار Migration ترقيم القيود؛ التشخيص المحمي: ${logPath}`);
    }
    const after = psql(businessStateSql);
    if (!output.includes(marker) || before !== after) {
      throw new Error("فشل عقد ترقيم القيود أو تغيرت بيانات L3 بعد ROLLBACK");
    }
    const reportPath = join(reportDir, "report.json");
    writeFileSync(reportPath, `${JSON.stringify({
      status: marker,
      verifiedAt: new Date().toISOString(),
      scenarios: 8,
      legacyRowsBackfilled: 3,
      container,
      database,
      transactionRolledBack: true,
      isolatedBusinessStatePreserved: true,
      prefixStoredOutsideJournalNumber: true,
      productionOrHostedStagingModified: false,
    }, null, 2)}\n`, { mode: 0o600 });
    console.log("نجحت Migration ترقيم القيود في السيناريوهات الثمانية داخل L3 المعزولة");
    console.log("تم الرجوع عن الحماية والعينات بالكامل؛ لم تتغير L3 أو Staging أو الإنتاج");
    console.log(`التقرير: ${reportPath}`);
    return;
  }

  if (mode === "--test-explicit-rollback") {
    const migration = readFileSync(migrationPath, "utf8");
    const rollback = readFileSync(rollbackPath, "utf8");
    validateJournalPostedNumberMigration(migration);
    validateJournalPostedNumberRollback(rollback);
    const reportDir = mkdtempSync("/tmp/accounting-journal-posted-number-rollback-report-");
    const logPath = join(reportDir, "run.log");
    let output;
    try {
      output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${legacyFixtureSql}
${transactionBody(migration)}
SELECT set_config('app.journal_posted_number_rollback_authorized', 'STAGING_20260923030000', true);
${transactionBody(rollback)}
DO $verify$
DECLARE
  v_create_def text;
  v_replace_def text;
BEGIN
  SELECT pg_get_functiondef('public.create_journal_entry(date,text,jsonb,text,integer,text)'::regprocedure)
  INTO v_create_def;
  SELECT pg_get_functiondef('public.replace_journal_entry_lines(uuid,jsonb,date,text,text)'::regprocedure)
  INTO v_replace_def;
  IF EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.journal_entries'::regclass
         AND conname = 'journal_entries_posted_number_required'
     )
     OR to_regclass('public.journal_entries_posted_number_unique') IS NOT NULL
     OR v_create_def LIKE '%pg_advisory_xact_lock%journal_entries.posted_number%'
     OR v_replace_def LIKE '%pg_advisory_xact_lock%journal_entries.posted_number%'
     OR EXISTS (
       SELECT 1
       FROM pg_temp.journal_posted_number_legacy_fixture fixture
       JOIN public.journal_entries entry ON entry.id = fixture.id
       WHERE entry.posted_number IS NULL
     ) THEN
    RAISE EXCEPTION 'JOURNAL_POSTED_NUMBER_EXPLICIT_ROLLBACK_INVALID';
  END IF;
END;
$verify$;
SELECT 'JOURNAL_POSTED_NUMBER_EXPLICIT_ROLLBACK_OK';
ROLLBACK;`);
    } catch (error) {
      writeDiagnostic(logPath, error.message);
      throw new Error(`فشل اختبار ملف رجوع ترقيم القيود؛ التشخيص المحمي: ${logPath}`);
    }
    const after = psql(businessStateSql);
    if (!output.includes("JOURNAL_POSTED_NUMBER_EXPLICIT_ROLLBACK_OK") || before !== after) {
      throw new Error("فشل تحقق الرجوع الصريح لترقيم القيود أو تغيرت بيانات L3");
    }
    const reportPath = join(reportDir, "report.json");
    writeFileSync(reportPath, `${JSON.stringify({
      status: "JOURNAL_POSTED_NUMBER_EXPLICIT_ROLLBACK_OK",
      verifiedAt: new Date().toISOString(),
      container,
      database,
      guardsRemoved: true,
      gatewayFunctionsRestored: true,
      assignedOfficialNumbersRetainedUntilOuterRollback: true,
      isolatedBusinessStatePreserved: true,
      productionOrHostedStagingModified: false,
    }, null, 2)}\n`, { mode: 0o600 });
    console.log("نجح اختبار ملف رجوع ترقيم القيود داخل L3 المعزولة");
    console.log("أزيلت الحماية وعادت البوابات السابقة مع الاحتفاظ بالأرقام الرسمية المعينة حتى الرجوع الخارجي");
    console.log(`التقرير: ${reportPath}`);
    return;
  }

  const output = psql(`\\set ON_ERROR_STOP on
BEGIN;
DO $red$
DECLARE
  v_create_def text;
BEGIN
  SELECT pg_get_functiondef('public.create_journal_entry(date,text,jsonb,text,integer,text)'::regprocedure)
  INTO v_create_def;
  IF EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.journal_entries'::regclass
         AND conname = 'journal_entries_posted_number_required'
     )
     OR to_regclass('public.journal_entries_posted_number_unique') IS NOT NULL
     OR v_create_def LIKE '%pg_advisory_xact_lock%journal_entries.posted_number%' THEN
    RAISE EXCEPTION 'JOURNAL_POSTED_NUMBER_INVARIANT_UNEXPECTEDLY_EXISTS';
  END IF;
END;
$red$;
SELECT 'TDD_JOURNAL_POSTED_NUMBER_INVARIANT_RED_OK';
ROLLBACK;`);
  if (!output.includes("TDD_JOURNAL_POSTED_NUMBER_INVARIANT_RED_OK")) {
    throw new Error("فشل إثبات TDD الأحمر لترقيم القيود المرحلة");
  }
  console.log("TDD_JOURNAL_POSTED_NUMBER_INVARIANT_RED_OK: العقد جاهز والحماية الجديدة غير موجودة كما هو متوقع");
  console.log("لم يُنشأ أو يُرقم أو يُعدّل أي قيد، ولم تتغير L3 أو Staging أو الإنتاج");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
