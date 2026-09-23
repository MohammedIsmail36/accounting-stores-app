// Permanently apply configurable 2D tax mappings to linked Staging only.
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateConfigurableTaxMigrationSql,
  validateConfigurableTaxRollbackSql,
} from "../tests/rehearse-inventory-reconciliation-configurable-tax-accounts.mjs";
import {
  baselineSql,
  extractNamedPayload,
  validateBaseline,
} from "./backup-inventory-configurable-tax-accounts-baseline.mjs";
import { sameBaseline } from "./rehearse-inventory-configurable-tax-accounts.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const baselineArchive = "/backups/staging/inventory-configurable-tax-before-20260923-055349/baseline";
const rehearsalArchive = "/backups/staging/inventory-configurable-tax-before-20260923-055349/transactional-rehearsal";
const migrationVersion = "20260923100000";
const migrationFilename = `${migrationVersion}_inventory_reconciliation_configurable_tax_accounts.sql`;
const migrationPath = join(root, "supabase/migrations", migrationFilename);
const rollbackPath = join(root, "supabase/rollback", migrationFilename);
const cli = "supabase@2.116.0";

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

function stableDiagnostic(value) {
  return {
    schema_version: value?.schema_version,
    source_scope: value?.source_scope,
    fingerprint: value?.fingerprint,
    status: value?.status,
    totals: value?.totals,
    issue_counts: value?.issue_counts,
  };
}

export function sameBusinessState(actual, expected) {
  const stable = (value) => ({
    database: value?.database,
    server_version: value?.server_version,
    project_ref: value?.project_ref,
    tax_settings: value?.tax_settings,
    counts: value?.counts,
    signatures: value?.signatures,
    diagnostic: stableDiagnostic(value?.diagnostic),
  });
  return JSON.stringify(canonical(stable(actual)))
    === JSON.stringify(canonical(stable(expected)));
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
    throw new Error(`فشل تطبيق حسابات الضريبة على Staging (${label})؛ التشخيص: ${logPath}`);
  }
  return { stdout: result.stdout ?? "", combined: output };
}

function runQuery(sql, reportDir, logPath, label, payload) {
  const path = join(reportDir, `${label}.sql`);
  writeFileSync(path, sql, { mode: 0o600 });
  const output = runCli(
    ["db", "query", "--linked", "--output-format", "json", "--file", path], logPath, label);
  return extractNamedPayload(output.stdout, payload);
}

export const schemaVerificationSql = `BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'project_ref', '${expectedProjectRef}',
  'migration_present', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${migrationVersion}'
  ),
  'functions', jsonb_build_object(
    'public_planner', to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NOT NULL,
    'base_planner', to_regprocedure('public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)') IS NOT NULL,
    'fixed_tax_legacy', to_regprocedure('public.get_inventory_reconciliation_journal_plan_base_2da_fixed_tax(text,uuid,date)') IS NOT NULL,
    'settings_validator', to_regprocedure('public.fn_validate_company_tax_account_mapping()') IS NOT NULL,
    'account_guard', to_regprocedure('public.fn_guard_configured_tax_account_shape()') IS NOT NULL,
    'base_contains_1105', position('1105' IN pg_get_functiondef(
      'public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)'::regprocedure)) > 0,
    'base_contains_2102', position('2102' IN pg_get_functiondef(
      'public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)'::regprocedure)) > 0
  ),
  'security', jsonb_build_object(
    'base_security_definer', (SELECT prosecdef FROM pg_proc
      WHERE oid = 'public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)'::regprocedure),
    'base_safe_search_path', (SELECT proconfig @> ARRAY['search_path=public, pg_temp']
      FROM pg_proc WHERE oid = 'public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)'::regprocedure),
    'base_authenticated_execute', has_function_privilege('authenticated',
      'public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)', 'EXECUTE'),
    'validator_authenticated_execute', has_function_privilege('authenticated',
      'public.fn_validate_company_tax_account_mapping()', 'EXECUTE'),
    'guard_authenticated_execute', has_function_privilege('authenticated',
      'public.fn_guard_configured_tax_account_shape()', 'EXECUTE')
  ),
  'triggers', jsonb_build_object(
    'settings_validator_count', (SELECT count(*) FROM pg_trigger
      WHERE tgrelid = 'public.company_settings'::regclass
        AND tgname = 'trg_validate_company_tax_account_mapping' AND NOT tgisinternal),
    'account_guard_count', (SELECT count(*) FROM pg_trigger
      WHERE tgrelid = 'public.accounts'::regclass
        AND tgname = 'trg_guard_configured_tax_account_shape' AND NOT tgisinternal)
  )
) AS schema_state;
ROLLBACK;
`;

export function validateApplySource(source) {
  for (const required of [
    expectedProjectRef,
    baselineArchive,
    rehearsalArchive,
    migrationVersion,
    "--dry-run",
    "--yes",
    "sameBaseline",
    "sameBusinessState",
    "base_contains_1105",
    "settings_validator_count",
    "STAGING_INVENTORY_CONFIGURABLE_TAX_APPLY_OK",
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

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  validateApplySource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  assertStagingLink();

  const baselinePath = join(baselineArchive, "baseline.json");
  const manifestPath = join(baselineArchive, "manifest.json");
  const rehearsalPath = join(rehearsalArchive, "result/report.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const rehearsal = JSON.parse(readFileSync(rehearsalPath, "utf8"));
  validateBaseline(baseline);
  if (manifest.result !== "STAGING_INVENTORY_CONFIGURABLE_TAX_BASELINE_OK"
      || manifest.files?.["baseline.json"]?.sha256 !== sha256(baselinePath)
      || rehearsal.result !== "STAGING_INVENTORY_CONFIGURABLE_TAX_REHEARSAL_OK"
      || !rehearsal.baselineRestoredAfterRollback
      || !rehearsal.explicitRollbackVerified) {
    throw new Error("نسخة Staging أو دليل التجربة غير صالحين");
  }

  const migration = readFileSync(migrationPath, "utf8");
  const rollback = readFileSync(rollbackPath, "utf8");
  validateConfigurableTaxMigrationSql(migration);
  validateConfigurableTaxRollbackSql(rollback);

  const reportDir = mkdtempSync("/tmp/accounting-staging-configurable-tax-apply-");
  const logPath = join(reportDir, "run.log");
  const before = runQuery(baselineSql, reportDir, logPath,
    "pre-apply-verification", "baseline");
  validateBaseline(before);
  if (!sameBaseline(before, baseline)) {
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

  const after = runQuery(baselineSql, reportDir, logPath,
    "post-apply-business-verification", "baseline");
  const schema = runQuery(schemaVerificationSql, reportDir, logPath,
    "post-apply-schema-verification", "schema_state");
  const security = schema?.security ?? {};
  const functions = schema?.functions ?? {};
  if (!sameBusinessState(after, before)
      || !after?.migration_state?.configurable_tax
      || !schema?.migration_present
      || !functions.public_planner
      || !functions.base_planner
      || !functions.fixed_tax_legacy
      || !functions.settings_validator
      || !functions.account_guard
      || functions.base_contains_1105
      || functions.base_contains_2102
      || !security.base_security_definer
      || !security.base_safe_search_path
      || security.base_authenticated_execute
      || security.validator_authenticated_execute
      || security.guard_authenticated_execute
      || schema?.triggers?.settings_validator_count !== 1
      || schema?.triggers?.account_guard_count !== 1) {
    throw new Error(`فشل التحقق بعد التطبيق؛ لا تكرر التطبيق: ${logPath}`);
  }

  writeFileSync(join(reportDir, "report.json"), `${JSON.stringify({
    result: "STAGING_INVENTORY_CONFIGURABLE_TAX_APPLY_OK",
    appliedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    migrationVersion,
    taxSettingsPreserved: true,
    businessCountsAndSignaturesPreserved: true,
    diagnosticPreserved: true,
    configurablePlannerInstalled: true,
    validationGuardsInstalled: true,
    internalFunctionsNotExecutableByAuthenticated: true,
    rollbackPath,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });

  console.log("تم تطبيق حسابات الضريبة القابلة للتهيئة على Staging والتحقق منها بنجاح");
  console.log("سُجل الإصدار، والحارسان والدوال والصلاحيات سليمة، ولم تتغير بيانات الأعمال أو إعدادات الضريبة");
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
