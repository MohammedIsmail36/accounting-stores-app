// Read-only Staging backup and baseline before enforcing official posted journal numbers.
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  chownSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const cli = "supabase@2.116.0";
const migrationVersion = "20260923030000";
const expectedMissingIds = [
  "13ab0c2f-36eb-46f4-8303-7fe4ffd3ed62",
  "48e27ca9-0ad1-4c47-9765-457f8181ff61",
  "4f131e2f-14d1-4e4d-ada1-31830fa1ea70",
];

function assertStagingLink() {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }
}

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") {
      throw new Error("شغّل النسخة بواسطة sudo من حساب deploy فقط");
    }
    const accessToken = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
    if (!accessToken) throw new Error("جلسة Supabase للمستخدم deploy غير موجودة");
    return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: accessToken };
  }
  return process.env;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeDiagnostic(path, message) {
  appendFileSync(path, `\n=== diagnostic ===\n${message}\n`, { mode: 0o600 });
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  if (Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) {
    chownSync(path, uid, gid);
  }
}

function runCli(args, logPath) {
  assertStagingLink();
  const result = spawnSync("npx", ["-y", cli, ...args], {
    cwd: root,
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 96 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    appendFileSync(logPath,
      `\n=== supabase ${args.join(" ")} ===\n${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\n`,
      { mode: 0o600 });
    throw new Error(`فشل إنشاء نسخة Staging قبل ترقيم القيود؛ التشخيص: ${logPath}`);
  }
  return result.stdout;
}

export function extractNamedPayload(output, name) {
  const parsed = typeof output === "string" ? JSON.parse(output) : output;
  const visit = (value) => {
    if (!value || typeof value !== "object") return undefined;
    if (Object.prototype.hasOwnProperty.call(value, name)) return value[name];
    for (const child of Object.values(value)) {
      const found = visit(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return visit(parsed);
}

export const baselineSql = `BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'project_ref', '${expectedProjectRef}',
  'migration_present', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${migrationVersion}'
  ),
  'guard_state', jsonb_build_object(
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
  'configured_prefix', (
    SELECT journal_entry_prefix FROM public.company_settings ORDER BY created_at ASC LIMIT 1
  ),
  'journal_state', jsonb_build_object(
    'count', (SELECT count(*) FROM public.journal_entries),
    'posted_count', (SELECT count(*) FROM public.journal_entries WHERE status = 'posted'),
    'posted_without_number', (SELECT count(*) FROM public.journal_entries
      WHERE status = 'posted' AND posted_number IS NULL),
    'max_posted_number', (SELECT COALESCE(max(posted_number), 0) FROM public.journal_entries),
    'duplicate_posted_numbers', (SELECT count(*) FROM (
      SELECT posted_number FROM public.journal_entries WHERE posted_number IS NOT NULL
      GROUP BY posted_number HAVING count(*) > 1
    ) duplicates),
    'signature', (SELECT md5(COALESCE(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id), ''))
      FROM public.journal_entries j),
    'lines_count', (SELECT count(*) FROM public.journal_entry_lines),
    'lines_signature', (SELECT md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), ''))
      FROM public.journal_entry_lines l)
  ),
  'missing_rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'entry_number', entry_number,
      'status', status,
      'description', description
    ) ORDER BY entry_number, id)
    FROM public.journal_entries
    WHERE status = 'posted' AND posted_number IS NULL
  ), '[]'::jsonb)
) AS baseline;
ROLLBACK;
`;

export function validateBaseline(baseline) {
  const failures = [];
  if (!baseline) failures.push("baseline_missing");
  if (baseline?.database !== "postgres") failures.push("database_identity");
  if (baseline?.project_ref !== expectedProjectRef) failures.push("project_identity");
  if (!baseline?.server_version?.startsWith("17.")) failures.push("server_version");
  if (baseline?.migration_present) failures.push("migration_already_present");
  if (Object.values(baseline?.guard_state ?? {}).some(Boolean)) failures.push("guards_already_present");
  if (typeof baseline?.configured_prefix !== "string" || baseline.configured_prefix.trim() === "") {
    failures.push("configured_prefix_missing");
  }
  if (baseline?.journal_state?.posted_without_number !== 3) failures.push("unexpected_missing_number_count");
  if (baseline?.journal_state?.duplicate_posted_numbers !== 0) failures.push("duplicate_posted_numbers");
  if (failures.length > 0) {
    throw new Error(`خط أساس Staging قبل ترقيم القيود غير آمن: ${failures.join(",")}`);
  }
  const actualIds = (baseline.missing_rows ?? []).map((row) => row.id).sort();
  if (JSON.stringify(actualIds) !== JSON.stringify([...expectedMissingIds].sort())) {
    throw new Error("القيود المرحلة بلا أرقام لا تطابق القيود الثلاثة المعروفة");
  }
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStagingLink();
  process.umask(0o077);
  const outputDir = mkdtempSync("/tmp/staging-journal-posted-number-before-");
  chmodSync(outputDir, 0o700);
  const schemaPath = join(outputDir, "public-schema.sql");
  const dataPath = join(outputDir, "public-data.sql");
  const queryPath = join(outputDir, "baseline-query.sql");
  const baselinePath = join(outputDir, "baseline.json");
  const manifestPath = join(outputDir, "manifest.json");
  const logPath = join(outputDir, "run.log");
  writeFileSync(queryPath, baselineSql, { mode: 0o600 });

  try {
    runCli(["db", "dump", "--linked", "--schema", "public", "--file", schemaPath], logPath);
    runCli(["db", "dump", "--linked", "--schema", "public", "--data-only", "--use-copy", "--file", dataPath], logPath);
    chmodSync(schemaPath, 0o600);
    chmodSync(dataPath, 0o600);
    if (statSync(schemaPath).size < 10_000 || statSync(dataPath).size < 10_000) {
      throw new Error("نسخة Staging غير مكتملة");
    }
    const queryOutput = runCli(
      ["db", "query", "--linked", "--output-format", "json", "--file", queryPath], logPath);
    writeFileSync(join(outputDir, "query-output.json"), queryOutput, { mode: 0o600 });
    const baseline = extractNamedPayload(queryOutput, "baseline");
    writeFileSync(join(outputDir, "baseline-candidate.json"),
      `${JSON.stringify(baseline ?? null, null, 2)}\n`, { mode: 0o600 });
    validateBaseline(baseline);
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 });

    const files = [schemaPath, dataPath, queryPath, baselinePath];
    const manifest = {
      result: "STAGING_JOURNAL_POSTED_NUMBER_BASELINE_OK",
      projectRef: expectedProjectRef,
      createdAt: new Date().toISOString(),
      readOnly: true,
      configuredPrefix: baseline.configured_prefix,
      postedWithoutNumber: baseline.journal_state.posted_without_number,
      expectedBackfillIdsMatched: true,
      productionModified: false,
      files: Object.fromEntries(files.map((path) => [path.split("/").at(-1), {
        bytes: statSync(path).size,
        sha256: sha256(path),
      }])),
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(join(outputDir, "SHA256SUMS"), `${[...files, manifestPath]
      .map((path) => `${sha256(path)}  ${path.split("/").at(-1)}`).join("\n")}\n`, { mode: 0o600 });

    console.log("تم إنشاء نسخة Staging وخط أساس ترقيم القيود دون كتابة على القاعدة");
    console.log(`SOURCE_DIR=${outputDir}`);
    console.log(`CONFIGURED_PREFIX=${baseline.configured_prefix}`);
    console.log(`POSTED_WITHOUT_NUMBER=${baseline.journal_state.posted_without_number}`);
  } catch (error) {
    writeDiagnostic(logPath, error.message);
    throw new Error(`${error.message}؛ الملفات التشخيصية: ${outputDir}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
