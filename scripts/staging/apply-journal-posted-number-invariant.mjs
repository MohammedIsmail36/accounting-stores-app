// Permanently apply official posted journal numbering to the linked Staging project only.
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateJournalPostedNumberMigration,
  validateJournalPostedNumberRollback,
} from "../tests/rehearse-journal-posted-number-invariant.mjs";
import { extractNamedPayload, validateBaseline } from "./backup-journal-posted-number-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const baselineArchive = "/backups/staging/journal-posted-number-before-20260923-033809";
const rehearsalArchive = join(baselineArchive, "transactional-rehearsal-transaction-wrapper");
const migrationVersion = "20260923030000";
const migrationFilename = `${migrationVersion}_journal_posted_number_invariant.sql`;
const migrationPath = join(root, "supabase/migrations", migrationFilename);
const rollbackPath = join(root, "supabase/rollback", migrationFilename);
const cli = "supabase@2.116.0";
const expectedMissingIds = [
  "13ab0c2f-36eb-46f4-8303-7fe4ffd3ed62",
  "48e27ca9-0ad1-4c47-9765-457f8181ff61",
  "4f131e2f-14d1-4e4d-ada1-31830fa1ea70",
];

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") {
      throw new Error("شغّل التطبيق بواسطة sudo من حساب deploy فقط");
    }
    const accessToken = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
    if (!accessToken) throw new Error("جلسة Supabase للمستخدم deploy غير موجودة");
    return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: accessToken };
  }
  return process.env;
}

function assertStagingLink() {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }
}

function runCli(args, logPath, label) {
  assertStagingLink();
  const result = spawnSync("npx", ["-y", cli, ...args], {
    cwd: root,
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 420000,
    maxBuffer: 96 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  appendFileSync(logPath, `\n=== ${label} ===\n${output}\n`, { mode: 0o600 });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    throw new Error(`فشل تطبيق ترقيم القيود على Staging (${label})؛ التشخيص: ${logPath}`);
  }
  return { stdout: result.stdout ?? "", combined: output };
}

function runQuery(sql, reportDir, logPath, label) {
  const path = join(reportDir, `${label}.sql`);
  writeFileSync(path, sql, { mode: 0o600 });
  const output = runCli(
    ["db", "query", "--linked", "--output-format", "json", "--file", path], logPath, label);
  return extractNamedPayload(output.stdout, "state");
}

export const stateSql = `BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'project_ref', '${expectedProjectRef}',
  'migration_present', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${migrationVersion}'
  ),
  'configured_prefix', (
    SELECT journal_entry_prefix FROM public.company_settings ORDER BY created_at ASC LIMIT 1
  ),
  'guards', jsonb_build_object(
    'constraint_present', EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.journal_entries'::regclass
        AND conname = 'journal_entries_posted_number_required'
    ),
    'unique_index_present', to_regclass('public.journal_entries_posted_number_unique') IS NOT NULL,
    'create_gateway_atomic', position('pg_advisory_xact_lock' IN pg_get_functiondef(
      'public.create_journal_entry(date,text,jsonb,text,integer,text)'::regprocedure)) > 0,
    'replace_gateway_atomic', position('pg_advisory_xact_lock' IN pg_get_functiondef(
      'public.replace_journal_entry_lines(uuid,jsonb,date,text,text)'::regprocedure)) > 0
  ),
  'journals', jsonb_build_object(
    'count', (SELECT count(*) FROM public.journal_entries),
    'posted_without_number', (SELECT count(*) FROM public.journal_entries
      WHERE status = 'posted' AND posted_number IS NULL),
    'max_posted_number', (SELECT COALESCE(max(posted_number), 0) FROM public.journal_entries),
    'duplicate_posted_numbers', (SELECT count(*) FROM (
      SELECT posted_number FROM public.journal_entries WHERE posted_number IS NOT NULL
      GROUP BY posted_number HAVING count(*) > 1
    ) duplicates),
    'core_signature', (SELECT md5(COALESCE(string_agg(
      (to_jsonb(j) - 'posted_number' - 'updated_at')::text, '|' ORDER BY j.id), ''))
      FROM public.journal_entries j),
    'lines_count', (SELECT count(*) FROM public.journal_entry_lines),
    'lines_signature', (SELECT md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), ''))
      FROM public.journal_entry_lines l)
  ),
  'target_rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'entry_number', entry_number,
      'posted_number', posted_number
    ) ORDER BY entry_number, id)
    FROM public.journal_entries
    WHERE id = ANY(ARRAY[
      '${expectedMissingIds[0]}'::uuid,
      '${expectedMissingIds[1]}'::uuid,
      '${expectedMissingIds[2]}'::uuid
    ])
  ), '[]'::jsonb)
) AS state;
ROLLBACK;
`;

export function validateApplySource(source) {
  for (const required of [
    expectedProjectRef,
    baselineArchive,
    "transactional-rehearsal-transaction-wrapper",
    migrationVersion,
    "journal_posted_number_invariant.sql",
    "--dry-run",
    "--yes",
    "core_signature",
    "posted_without_number",
    "configured_prefix",
    "expectedNumbers",
    "STAGING_JOURNAL_POSTED_NUMBER_APPLY_OK",
  ]) {
    if (!source.includes(required)) throw new Error(`حاجز مفقود من تطبيق Staging: ${required}`);
  }
  for (const forbidden of [
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /supabase\s+db\s+reset/i,
  ]) {
    if (forbidden.test(source)) throw new Error(`وجهة أو أمر ممنوع في تطبيق Staging: ${forbidden}`);
  }
}

function validateIdentity(state) {
  if (!state
      || state.database !== "postgres"
      || state.project_ref !== expectedProjectRef
      || !state.server_version?.startsWith("17.")) {
    throw new Error("هوية قاعدة Staging لا تطابق المتوقع");
  }
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  validateApplySource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  assertStagingLink();

  const baselinePath = join(baselineArchive, "baseline.json");
  const manifestPath = join(baselineArchive, "manifest.json");
  const rehearsalReportPath = join(rehearsalArchive, "result/report.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const rehearsal = JSON.parse(readFileSync(rehearsalReportPath, "utf8"));
  validateBaseline(baseline);
  if (manifest.result !== "STAGING_JOURNAL_POSTED_NUMBER_BASELINE_OK"
      || manifest.files?.["baseline.json"]?.sha256 !== sha256(baselinePath)
      || rehearsal.result !== "STAGING_JOURNAL_POSTED_NUMBER_REHEARSAL_OK"
      || !rehearsal.baselineRestoredAfterRollback) {
    throw new Error("نسخة Staging أو دليل التجربة غير صالحين");
  }

  const migration = readFileSync(migrationPath, "utf8");
  const rollback = readFileSync(rollbackPath, "utf8");
  validateJournalPostedNumberMigration(migration);
  validateJournalPostedNumberRollback(rollback);

  const reportDir = mkdtempSync("/tmp/accounting-staging-journal-posted-number-apply-");
  const logPath = join(reportDir, "run.log");
  const before = runQuery(stateSql, reportDir, logPath, "pre-apply-verification");
  validateIdentity(before);
  if (before.migration_present
      || Object.values(before.guards ?? {}).some(Boolean)
      || before.configured_prefix !== baseline.configured_prefix
      || before.journals?.count !== baseline.journal_state?.count
      || before.journals?.lines_count !== baseline.journal_state?.lines_count
      || before.journals?.lines_signature !== baseline.journal_state?.lines_signature
      || before.journals?.posted_without_number !== 3
      || before.journals?.duplicate_posted_numbers !== 0
      || before.target_rows?.length !== 3
      || before.target_rows.some((row) => row.posted_number !== null)) {
    throw new Error(`تغيرت Staging منذ النسخة؛ أُلغي التطبيق: ${logPath}`);
  }

  const dryRun = runCli(
    ["db", "push", "--linked", "--dry-run"], logPath, "migration-dry-run").combined;
  const migrationNames = [...new Set(
    [...dryRun.matchAll(/\b(\d{14}_[A-Za-z0-9_]+\.sql)\b/g)].map((match) => match[1]),
  )];
  if (migrationNames.length !== 1 || migrationNames[0] !== migrationFilename) {
    throw new Error(`الفحص الجاف لا يحتوي Migration المطلوبة وحدها؛ أُلغي التطبيق: ${logPath}`);
  }

  runCli(["db", "push", "--linked", "--yes"], logPath, "migration-apply");

  const after = runQuery(stateSql, reportDir, logPath, "post-apply-verification");
  validateIdentity(after);
  const expectedNumbers = [...before.target_rows]
    .sort((left, right) => left.entry_number - right.entry_number || left.id.localeCompare(right.id))
    .map((row, index) => ({ id: row.id, posted_number: before.journals.max_posted_number + index + 1 }));
  const actualNumbers = [...after.target_rows]
    .sort((left, right) => left.entry_number - right.entry_number || left.id.localeCompare(right.id))
    .map((row) => ({ id: row.id, posted_number: row.posted_number }));
  if (!after.migration_present
      || Object.values(after.guards ?? {}).some((value) => !value)
      || after.configured_prefix !== before.configured_prefix
      || after.journals?.count !== before.journals?.count
      || after.journals?.lines_count !== before.journals?.lines_count
      || after.journals?.lines_signature !== before.journals?.lines_signature
      || after.journals?.core_signature !== before.journals?.core_signature
      || after.journals?.posted_without_number !== 0
      || after.journals?.duplicate_posted_numbers !== 0
      || after.journals?.max_posted_number !== before.journals?.max_posted_number + 3
      || JSON.stringify(actualNumbers) !== JSON.stringify(expectedNumbers)) {
    throw new Error(`فشل التحقق بعد التطبيق؛ استخدم ملف الرجوع المحفوظ ولا تكرر التطبيق: ${logPath}`);
  }

  const reportPath = join(reportDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify({
    result: "STAGING_JOURNAL_POSTED_NUMBER_APPLY_OK",
    appliedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    migrationVersion,
    configuredPrefix: after.configured_prefix,
    assignedNumbers: actualNumbers,
    journalCountPreserved: true,
    journalLinesPreserved: true,
    journalCoreDataPreserved: true,
    uniqueConstraintAndAtomicGatewaysVerified: true,
    rollbackPath,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });

  console.log("تم تطبيق إصلاح ترقيم القيود على Staging والتحقق منه بنجاح");
  console.log(`CONFIGURED_PREFIX=${after.configured_prefix}`);
  console.log(`ASSIGNED_NUMBERS=${actualNumbers.map((row) => row.posted_number).join(",")}`);
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
