// Independent read-only verification after configurable tax mappings on Staging.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  baselineSql,
  extractNamedPayload,
  validateBaseline,
} from "./backup-inventory-configurable-tax-accounts-baseline.mjs";
import {
  sameBusinessState,
  schemaVerificationSql,
} from "./apply-inventory-configurable-tax-accounts.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const baselineArchive = "/backups/staging/inventory-configurable-tax-before-20260923-055349/baseline";
const migrationVersion = "20260923100000";
const cli = "supabase@2.116.0";

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

function runQuery(sql, reportDir, logPath, name, payload) {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }
  const queryPath = join(reportDir, `${name}.sql`);
  writeFileSync(queryPath, sql, { mode: 0o600 });
  const result = spawnSync("npx", [
    "-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", queryPath,
  ], {
    cwd: root,
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 96 * 1024 * 1024,
  });
  writeFileSync(logPath,
    `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.stack ?? ""}\n`,
    { mode: 0o600 });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    throw new Error(`فشل تحقق حسابات الضريبة بعد التطبيق؛ التشخيص: ${logPath}`);
  }
  return extractNamedPayload(result.stdout, payload);
}

export const definitionVerificationSql = `BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
  'database', current_database(),
  'project_ref', '${expectedProjectRef}',
  'migration_present', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${migrationVersion}'
  ),
  'planner_definition', jsonb_build_object(
    'uses_purchase_setting_code', position('v_purchase_tax_code' IN pg_get_functiondef(
      'public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)'::regprocedure)) > 0,
    'uses_sales_setting_code', position('v_sales_tax_code' IN pg_get_functiondef(
      'public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)'::regprocedure)) > 0,
    'contains_fixed_1105', position('1105' IN pg_get_functiondef(
      'public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)'::regprocedure)) > 0,
    'contains_fixed_2102', position('2102' IN pg_get_functiondef(
      'public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)'::regprocedure)) > 0
  ),
  'validator_definition', jsonb_build_object(
    'purchase_asset', position('account_type = ''asset''' IN pg_get_functiondef(
      'public.fn_validate_company_tax_account_mapping()'::regprocedure)) > 0,
    'sales_liability', position('account_type = ''liability''' IN pg_get_functiondef(
      'public.fn_validate_company_tax_account_mapping()'::regprocedure)) > 0,
    'checks_active', position('is_active IS TRUE' IN pg_get_functiondef(
      'public.fn_validate_company_tax_account_mapping()'::regprocedure)) > 0,
    'checks_leaf', position('is_parent IS FALSE' IN pg_get_functiondef(
      'public.fn_validate_company_tax_account_mapping()'::regprocedure)) > 0
  )
) AS definition_state;
ROLLBACK;
`;

export function validateVerifierSource(source) {
  for (const required of [
    expectedProjectRef,
    baselineArchive,
    migrationVersion,
    "BEGIN TRANSACTION READ ONLY;",
    "uses_purchase_setting_code",
    "purchase_asset",
    "sameBusinessState",
    "STAGING_INVENTORY_CONFIGURABLE_TAX_POST_APPLY_OK",
    "productionModified: false",
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

  const reportDir = mkdtempSync("/tmp/accounting-staging-configurable-tax-postapply-");
  const logPath = join(reportDir, "run.log");
  const business = runQuery(baselineSql, reportDir, logPath,
    "business-verification", "baseline");
  const schema = runQuery(schemaVerificationSql, reportDir, logPath,
    "schema-verification", "schema_state");
  const definitions = runQuery(definitionVerificationSql, reportDir, logPath,
    "definition-verification", "definition_state");
  const functions = schema?.functions ?? {};
  const security = schema?.security ?? {};
  const planner = definitions?.planner_definition ?? {};
  const validator = definitions?.validator_definition ?? {};

  if (!sameBusinessState(business, baseline)
      || !business?.migration_state?.configurable_tax
      || !schema?.migration_present
      || !functions.public_planner || !functions.base_planner || !functions.fixed_tax_legacy
      || !functions.settings_validator || !functions.account_guard
      || functions.base_contains_1105 || functions.base_contains_2102
      || !security.base_security_definer || !security.base_safe_search_path
      || security.base_authenticated_execute
      || security.validator_authenticated_execute || security.guard_authenticated_execute
      || schema?.triggers?.settings_validator_count !== 1
      || schema?.triggers?.account_guard_count !== 1
      || definitions?.database !== "postgres"
      || definitions?.project_ref !== expectedProjectRef
      || !definitions?.migration_present
      || !planner.uses_purchase_setting_code || !planner.uses_sales_setting_code
      || planner.contains_fixed_1105 || planner.contains_fixed_2102
      || Object.values(validator).some((value) => value !== true)) {
    throw new Error(`تحقق ما بعد التطبيق غير مطابق؛ لا تعِد التطبيق: ${logPath}`);
  }

  writeFileSync(join(reportDir, "report.json"), `${JSON.stringify({
    result: "STAGING_INVENTORY_CONFIGURABLE_TAX_POST_APPLY_OK",
    verifiedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    migrationVersion,
    businessBaselinePreserved: true,
    taxSettingsPreserved: true,
    plannerUsesConfiguredAccounts: true,
    semanticAccountGuardsVerified: true,
    internalPermissionsVerified: true,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });

  console.log("نجح التحقق الرسمي بعد تطبيق حسابات الضريبة القابلة للتهيئة على Staging");
  console.log("الإصدار والدوال والحارسان والصلاحيات سليمة، وبيانات الأعمال وإعدادات الضريبة مطابقة للنسخة");
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
