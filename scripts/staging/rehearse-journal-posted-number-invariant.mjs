// Transactional rehearsal of official posted journal numbering on Staging only.
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  transactionBody,
  validateJournalPostedNumberMigration,
  validateJournalPostedNumberRollback,
} from "../tests/rehearse-journal-posted-number-invariant.mjs";
import {
  baselineSql,
  extractNamedPayload,
  validateBaseline,
} from "./backup-journal-posted-number-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const baselineArchive = "/backups/staging/journal-posted-number-before-20260923-033809";
const migrationPath = join(root,
  "supabase/migrations/20260923030000_journal_posted_number_invariant.sql");
const rollbackPath = join(root,
  "supabase/rollback/20260923030000_journal_posted_number_invariant.sql");
const cli = "supabase@2.116.0";
const marker = "STAGING_JOURNAL_POSTED_NUMBER_REHEARSAL_OK";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function sameBaseline(actual, expected) {
  return JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected));
}

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") {
      throw new Error("شغّل التجربة بواسطة sudo من حساب deploy فقط");
    }
    const accessToken = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
    if (!accessToken) throw new Error("جلسة Supabase للمستخدم deploy غير موجودة");
    return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: accessToken };
  }
  return process.env;
}

function runCli(filePath, logPath, label) {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }
  const result = spawnSync("npx", [
    "-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", filePath,
  ], {
    cwd: root,
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 420000,
    maxBuffer: 96 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    appendFileSync(logPath,
      `\n=== ${label} ===\n${output}\n${result.error?.stack ?? ""}\n`, { mode: 0o600 });
    throw new Error(`فشلت تجربة ترقيم القيود على Staging (${label})؛ التشخيص: ${logPath}`);
  }
  return result.stdout;
}

export function validateRehearsalSource(source) {
  for (const required of [
    expectedProjectRef,
    baselineArchive,
    "BEGIN;",
    "ROLLBACK;",
    "journal_posted_number_expected",
    "journal_entries_posted_number_required",
    "journal_entries_posted_number_unique",
    "STAGING_20260923030000",
    marker,
  ]) {
    if (!source.includes(required)) throw new Error(`حاجز مفقود من تجربة Staging: ${required}`);
  }
  for (const forbidden of [
    /(?:^|\n)\s*COMMIT\s*;/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
  ]) {
    if (forbidden.test(source)) throw new Error(`وجهة أو عبارة ممنوعة في تجربة Staging: ${forbidden}`);
  }
}

function rehearsalSql(migration, rollback) {
  return `BEGIN;
CREATE TEMP TABLE journal_posted_number_expected ON COMMIT DROP AS
WITH current_max AS (
  SELECT COALESCE(max(posted_number), 0)::integer AS value
  FROM public.journal_entries
), missing AS (
  SELECT id, row_number() OVER (ORDER BY entry_number, id)::integer AS offset
  FROM public.journal_entries
  WHERE status = 'posted' AND posted_number IS NULL
)
SELECT missing.id, current_max.value + missing.offset AS expected_number
FROM current_max, missing;

${transactionBody(migration)}

DO $forward_verify$
DECLARE
  v_cash uuid;
  v_equity uuid;
  v_before integer;
  v_entry uuid;
  v_draft uuid;
  v_number integer;
  v_lines jsonb;
BEGIN
  IF (SELECT count(*) FROM pg_temp.journal_posted_number_expected) <> 3
     OR EXISTS (
       SELECT 1 FROM pg_temp.journal_posted_number_expected expected
       JOIN public.journal_entries entry ON entry.id = expected.id
       WHERE entry.posted_number IS DISTINCT FROM expected.expected_number
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.journal_entries'::regclass
         AND conname = 'journal_entries_posted_number_required'
     )
     OR to_regclass('public.journal_entries_posted_number_unique') IS NULL THEN
    RAISE EXCEPTION 'STAGING_JOURNAL_POSTED_NUMBER_FORWARD_INVALID';
  END IF;

  SELECT id INTO STRICT v_cash FROM public.accounts WHERE code = '1101';
  SELECT id INTO STRICT v_equity FROM public.accounts WHERE code = '3101';
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_cash, 'debit', 1, 'credit', 0),
    jsonb_build_object('account_id', v_equity, 'debit', 0, 'credit', 1));

  SELECT COALESCE(max(posted_number), 0) INTO v_before FROM public.journal_entries;
  v_entry := public.create_journal_entry(current_date,
    '__STAGING_POSTED_NUMBER_REHEARSAL__', v_lines, 'posted', NULL, 'regular');
  SELECT posted_number INTO v_number FROM public.journal_entries WHERE id = v_entry;
  IF v_number IS DISTINCT FROM v_before + 1 THEN
    RAISE EXCEPTION 'STAGING_JOURNAL_POSTED_NUMBER_CREATE_INVALID';
  END IF;

  v_draft := public.create_journal_entry(current_date,
    '__STAGING_POSTED_NUMBER_DRAFT_REHEARSAL__', v_lines, 'draft', NULL, 'regular');
  IF (SELECT posted_number FROM public.journal_entries WHERE id = v_draft) IS NOT NULL THEN
    RAISE EXCEPTION 'STAGING_JOURNAL_POSTED_NUMBER_DRAFT_INVALID';
  END IF;
  SELECT COALESCE(max(posted_number), 0) INTO v_before FROM public.journal_entries;
  PERFORM public.replace_journal_entry_lines(v_draft, v_lines, NULL, NULL, 'posted');
  SELECT posted_number INTO v_number FROM public.journal_entries WHERE id = v_draft;
  IF v_number IS DISTINCT FROM v_before + 1 THEN
    RAISE EXCEPTION 'STAGING_JOURNAL_POSTED_NUMBER_REPLACE_INVALID';
  END IF;

  BEGIN
    INSERT INTO public.journal_entries(
      entry_date, description, status, total_debit, total_credit, posted_number)
    VALUES (current_date, '__STAGING_POSTED_NUMBER_INVALID__', 'posted', 1, 1, NULL);
    RAISE EXCEPTION 'STAGING_JOURNAL_POSTED_WITHOUT_NUMBER_ALLOWED';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%journal_entries_posted_number_required%' THEN RAISE; END IF;
  END;
END;
$forward_verify$;

SELECT set_config('app.journal_posted_number_rollback_authorized',
  'STAGING_20260923030000', true);
${transactionBody(rollback)}

DO $rollback_verify$
DECLARE
  v_create_def text;
  v_replace_def text;
BEGIN
  SELECT pg_get_functiondef(
    'public.create_journal_entry(date,text,jsonb,text,integer,text)'::regprocedure)
  INTO v_create_def;
  SELECT pg_get_functiondef(
    'public.replace_journal_entry_lines(uuid,jsonb,date,text,text)'::regprocedure)
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
       SELECT 1 FROM pg_temp.journal_posted_number_expected expected
       JOIN public.journal_entries entry ON entry.id = expected.id
       WHERE entry.posted_number IS NULL
     ) THEN
    RAISE EXCEPTION 'STAGING_JOURNAL_POSTED_NUMBER_ROLLBACK_INVALID';
  END IF;
END;
$rollback_verify$;

SELECT '${marker}' AS result;
ROLLBACK;
`;
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  validateRehearsalSource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }

  const baselinePath = join(baselineArchive, "baseline.json");
  const manifestPath = join(baselineArchive, "manifest.json");
  const checksumsPath = join(baselineArchive, "SHA256SUMS");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  validateBaseline(baseline);
  if (manifest.result !== "STAGING_JOURNAL_POSTED_NUMBER_BASELINE_OK"
      || manifest.projectRef !== expectedProjectRef
      || manifest.files?.["baseline.json"]?.sha256 !== sha256(baselinePath)
      || !readFileSync(checksumsPath, "utf8").includes(sha256(baselinePath))) {
    throw new Error("خط أساس ترقيم القيود غير صالح أو تغيرت بصمته");
  }

  const migration = readFileSync(migrationPath, "utf8");
  const rollback = readFileSync(rollbackPath, "utf8");
  validateJournalPostedNumberMigration(migration);
  validateJournalPostedNumberRollback(rollback);

  const reportDir = mkdtempSync("/tmp/accounting-staging-journal-posted-number-rehearsal-");
  const baselineQueryPath = join(reportDir, "baseline-query.sql");
  const rehearsalPath = join(reportDir, "rehearsal.sql");
  const reportPath = join(reportDir, "report.json");
  const logPath = join(reportDir, "run.log");
  writeFileSync(baselineQueryPath, baselineSql, { mode: 0o600 });

  const before = extractNamedPayload(
    runCli(baselineQueryPath, logPath, "baseline-preflight"), "baseline");
  validateBaseline(before);
  if (!sameBaseline(before, baseline)) {
    throw new Error(`تغيرت Staging منذ النسخة؛ ألغيت التجربة: ${logPath}`);
  }

  writeFileSync(rehearsalPath, rehearsalSql(migration, rollback), { mode: 0o600 });
  const output = runCli(rehearsalPath, logPath, "forward-and-explicit-rollback");
  if (!output.includes(marker)) throw new Error(`لم تظهر علامة نجاح التجربة: ${logPath}`);

  const after = extractNamedPayload(
    runCli(baselineQueryPath, logPath, "post-rollback-baseline"), "baseline");
  validateBaseline(after);
  if (!sameBaseline(after, baseline)) {
    throw new Error(`لم تعد Staging إلى خط الأساس بعد ROLLBACK: ${logPath}`);
  }

  writeFileSync(reportPath, `${JSON.stringify({
    result: marker,
    verifiedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    baselineArchive,
    postedRowsBackfilledInsideRolledBackTransaction: 3,
    createGatewayAutoNumberVerified: true,
    replaceGatewayAutoNumberVerified: true,
    directInvalidWriteRejected: true,
    explicitRollbackVerified: true,
    configuredPrefixUntouched: baseline.configured_prefix,
    baselineRestoredAfterRollback: true,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });

  console.log("نجحت تجربة ترقيم القيود على Staging داخل معاملة انتهت بـ ROLLBACK كامل");
  console.log("نجح الترقيم الذري والرجوع الصريح وعادت بيانات Staging إلى خط الأساس");
  console.log(`CONFIGURED_PREFIX=${baseline.configured_prefix}`);
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
