// Read-only verification after applying official posted journal numbering to Staging.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractNamedPayload, validateBaseline } from "./backup-journal-posted-number-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const baselineArchive = "/backups/staging/journal-posted-number-before-20260923-033809";
const migrationVersion = "20260923030000";
const cli = "supabase@2.116.0";
const targets = [
  ["13ab0c2f-36eb-46f4-8303-7fe4ffd3ed62", 312],
  ["48e27ca9-0ad1-4c47-9765-457f8181ff61", 313],
  ["4f131e2f-14d1-4e4d-ada1-31830fa1ea70", 314],
];

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") {
      throw new Error("شغّل التحقق بواسطة sudo من حساب deploy فقط");
    }
    const accessToken = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
    if (!accessToken) throw new Error("جلسة Supabase للمستخدم deploy غير موجودة");
    return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: accessToken };
  }
  return process.env;
}

function runQuery(path, logPath) {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }
  const result = spawnSync("npx", [
    "-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", path,
  ], {
    cwd: root,
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 96 * 1024 * 1024,
  });
  writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n`, { mode: 0o600 });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    throw new Error(`فشل تحقق ترقيم القيود بعد التطبيق؛ التشخيص: ${logPath}`);
  }
  return extractNamedPayload(result.stdout, "verification");
}

export const verificationSql = `BEGIN TRANSACTION READ ONLY;
WITH expected(id, posted_number) AS (
  VALUES
    ('${targets[0][0]}'::uuid, ${targets[0][1]}::integer),
    ('${targets[1][0]}'::uuid, ${targets[1][1]}::integer),
    ('${targets[2][0]}'::uuid, ${targets[2][1]}::integer)
), audit_proof AS (
  SELECT audit.record_id::uuid AS id,
    expected.posted_number,
    audit.created_at,
    (audit.old_data - 'posted_number' - 'updated_at')
      = (audit.new_data - 'posted_number' - 'updated_at') AS only_number_and_timestamp_changed
  FROM public.audit_log audit
  JOIN expected ON expected.id::text = audit.record_id
  WHERE audit.table_name = 'journal_entries'
    AND audit.action = 'UPDATE'
    AND audit.old_data->>'posted_number' IS NULL
    AND (audit.new_data->>'posted_number')::integer = expected.posted_number
)
SELECT jsonb_build_object(
  'result', 'STAGING_JOURNAL_POSTED_NUMBER_POST_APPLY_OK',
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
    'lines_count', (SELECT count(*) FROM public.journal_entry_lines),
    'lines_signature', (SELECT md5(COALESCE(string_agg(to_jsonb(line)::text, '|' ORDER BY line.id), ''))
      FROM public.journal_entry_lines line),
    'posted_without_number', (SELECT count(*) FROM public.journal_entries
      WHERE status = 'posted' AND posted_number IS NULL),
    'duplicate_posted_numbers', (SELECT count(*) FROM (
      SELECT posted_number FROM public.journal_entries WHERE posted_number IS NOT NULL
      GROUP BY posted_number HAVING count(*) > 1
    ) duplicates),
    'max_posted_number', (SELECT COALESCE(max(posted_number), 0) FROM public.journal_entries)
  ),
  'targets', (SELECT jsonb_agg(jsonb_build_object(
      'id', entry.id,
      'entry_number', entry.entry_number,
      'posted_number', entry.posted_number
    ) ORDER BY entry.entry_number, entry.id)
    FROM public.journal_entries entry JOIN expected ON expected.id = entry.id),
  'audit_proof', (SELECT jsonb_agg(jsonb_build_object(
      'id', proof.id,
      'posted_number', proof.posted_number,
      'created_at', proof.created_at,
      'only_number_and_timestamp_changed', proof.only_number_and_timestamp_changed
    ) ORDER BY proof.posted_number)
    FROM audit_proof proof)
) AS verification;
ROLLBACK;
`;

export function validateVerifierSource(source) {
  for (const required of [
    expectedProjectRef,
    baselineArchive,
    migrationVersion,
    "BEGIN TRANSACTION READ ONLY;",
    "audit_proof",
    "only_number_and_timestamp_changed",
    "journal_entry_prefix",
    "ROLLBACK;",
  ]) {
    if (!source.includes(required)) throw new Error(`حاجز مفقود من تحقق ما بعد التطبيق: ${required}`);
  }
  for (const forbidden of [/(?:farida|alibea)-db/i, /https?:\/\//i]) {
    if (forbidden.test(source)) throw new Error(`وجهة ممنوعة في تحقق ما بعد التطبيق: ${forbidden}`);
  }
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا الفاحص لا يقبل معاملات");
  validateVerifierSource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  const baseline = JSON.parse(readFileSync(join(baselineArchive, "baseline.json"), "utf8"));
  validateBaseline(baseline);
  const reportDir = mkdtempSync("/tmp/accounting-staging-journal-posted-number-postapply-");
  const queryPath = join(reportDir, "post-apply-verification.sql");
  const logPath = join(reportDir, "run.log");
  const reportPath = join(reportDir, "report.json");
  writeFileSync(queryPath, verificationSql, { mode: 0o600 });
  const result = runQuery(queryPath, logPath);
  const actualTargets = (result?.targets ?? []).map((row) => [row.id, row.posted_number]);
  const audit = result?.audit_proof ?? [];
  if (!result
      || result.result !== "STAGING_JOURNAL_POSTED_NUMBER_POST_APPLY_OK"
      || result.database !== "postgres"
      || result.project_ref !== expectedProjectRef
      || !result.server_version?.startsWith("17.")
      || !result.migration_present
      || Object.values(result.guards ?? {}).some((value) => !value)
      || result.configured_prefix !== baseline.configured_prefix
      || result.journals?.count !== baseline.journal_state?.count
      || result.journals?.lines_count !== baseline.journal_state?.lines_count
      || result.journals?.lines_signature !== baseline.journal_state?.lines_signature
      || result.journals?.posted_without_number !== 0
      || result.journals?.duplicate_posted_numbers !== 0
      || result.journals?.max_posted_number !== 314
      || JSON.stringify(actualTargets) !== JSON.stringify(targets)
      || audit.length !== 3
      || audit.some((row) => !row.only_number_and_timestamp_changed)) {
    throw new Error(`تحقق ما بعد التطبيق غير مطابق؛ لا تعِد التطبيق: ${logPath}`);
  }
  writeFileSync(reportPath, `${JSON.stringify({
    ...result,
    baselineArchive,
    verifiedAt: new Date().toISOString(),
    journalAndLineCountsPreserved: true,
    lineDataPreserved: true,
    auditProvesOnlyPostedNumberAndUpdatedAtChanged: true,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجح التحقق الرسمي بعد تطبيق ترقيم القيود على Staging");
  console.log("الأرقام 312 و313 و314 صحيحة، وأثبت سجل التدقيق أن التغيير اقتصر على الرقم وتاريخ التعديل");
  console.log(`CONFIGURED_PREFIX=${result.configured_prefix}`);
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
