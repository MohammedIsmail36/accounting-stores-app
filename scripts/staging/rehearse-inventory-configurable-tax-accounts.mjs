// Transactional rehearsal of configurable 2D tax mappings on Staging only.
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateConfigurableTaxContractSql,
  validateConfigurableTaxMigrationSql,
  validateConfigurableTaxRollbackSql,
} from "../tests/rehearse-inventory-reconciliation-configurable-tax-accounts.mjs";
import {
  baselineSql,
  extractNamedPayload,
  validateBaseline,
} from "./backup-inventory-configurable-tax-accounts-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const baselineArchive = "/backups/staging/inventory-configurable-tax-before-20260923-055349/baseline";
const migrationPath = join(root,
  "supabase/migrations/20260923100000_inventory_reconciliation_configurable_tax_accounts.sql");
const rollbackPath = join(root,
  "supabase/rollback/20260923100000_inventory_reconciliation_configurable_tax_accounts.sql");
const contractPath = join(root,
  "supabase/tests/inventory_reconciliation_configurable_tax_accounts_contract.sql");
const cli = "supabase@2.116.0";
const contractMarker = "INVENTORY_RECONCILIATION_CONFIGURABLE_TAX_ACCOUNTS_CONTRACT_OK";
const rollbackMarker = "STAGING_CONFIGURABLE_TAX_ACCOUNTS_EXPLICIT_ROLLBACK_OK";

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

export function sameBaseline(actual, expected) {
  const stable = (value) => ({
    database: value?.database,
    server_version: value?.server_version,
    project_ref: value?.project_ref,
    migration_state: value?.migration_state,
    function_state: value?.function_state,
    trigger_state: value?.trigger_state,
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
      throw new Error("شغّل التجربة بواسطة sudo من حساب deploy فقط");
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

function runCli(filePath, logPath, label) {
  assertStagingLink();
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
    throw new Error(`فشلت تجربة حسابات الضريبة على Staging (${label})؛ التشخيص: ${logPath}`);
  }
  return result.stdout;
}

export function stagingContract(contract) {
  const transformed = contract
    .replace(/^\\set ON_ERROR_STOP on\s*/m, "")
    .replace(/^BEGIN;\s*/m, "")
    .replace("current_database() <> 'l3_public_restore'", "current_database() <> 'postgres'")
    .replace(
      /CREATE OR REPLACE FUNCTION auth\.role\(\)[\s\S]*?\$\$;\s*CREATE OR REPLACE FUNCTION auth\.uid\(\)[\s\S]*?\$\$;\s*/,
      "",
    );
  if (transformed.includes("l3_public_restore")
      || transformed.includes("CREATE OR REPLACE FUNCTION auth.")) {
    throw new Error("تعذر فصل محاكاة هوية L3 عن عقد Staging");
  }
  return transformed;
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStagingLink();

  const baselinePath = join(baselineArchive, "baseline.json");
  const manifestPath = join(baselineArchive, "manifest.json");
  const checksumsPath = join(baselineArchive, "SHA256SUMS");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  validateBaseline(baseline);
  if (manifest.result !== "STAGING_INVENTORY_CONFIGURABLE_TAX_BASELINE_OK"
      || manifest.projectRef !== expectedProjectRef
      || manifest.files?.["baseline.json"]?.sha256 !== sha256(baselinePath)
      || !readFileSync(checksumsPath, "utf8").includes(sha256(baselinePath))) {
    throw new Error("خط أساس حسابات الضريبة غير صالح أو تغيرت بصمته");
  }

  const migration = readFileSync(migrationPath, "utf8");
  const rollback = readFileSync(rollbackPath, "utf8");
  const contract = readFileSync(contractPath, "utf8");
  validateConfigurableTaxMigrationSql(migration);
  validateConfigurableTaxRollbackSql(rollback);
  validateConfigurableTaxContractSql(contract);

  const reportDir = mkdtempSync("/tmp/accounting-staging-configurable-tax-rehearsal-");
  const baselineBeforePath = join(reportDir, "baseline-before.sql");
  const rehearsalPath = join(reportDir, "rehearsal.sql");
  const explicitRollbackPath = join(reportDir, "explicit-rollback.sql");
  const baselineAfterPath = join(reportDir, "baseline-after.sql");
  const reportPath = join(reportDir, "report.json");
  const logPath = join(reportDir, "run.log");
  writeFileSync(baselineBeforePath, baselineSql, { mode: 0o600 });
  writeFileSync(baselineAfterPath, baselineSql, { mode: 0o600 });

  const before = extractNamedPayload(
    runCli(baselineBeforePath, logPath, "baseline-preflight"), "baseline");
  writeFileSync(join(reportDir, "expected-baseline.json"),
    `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(reportDir, "actual-baseline-before.json"),
    `${JSON.stringify(before ?? null, null, 2)}\n`, { mode: 0o600 });
  validateBaseline(before);
  if (!sameBaseline(before, baseline)) {
    throw new Error(`تغيرت Staging منذ النسخة؛ ألغيت التجربة: ${logPath}`);
  }

  writeFileSync(rehearsalPath,
    `BEGIN;\n${migration}\n${stagingContract(contract)}`, { mode: 0o600 });
  const rehearsalOutput = runCli(rehearsalPath, logPath, "migration-contract");
  if (!rehearsalOutput.includes(contractMarker)) {
    throw new Error(`لم تظهر علامة نجاح السيناريوهات الثمانية: ${logPath}`);
  }

  writeFileSync(explicitRollbackPath, `BEGIN;
${migration}
SELECT set_config(
  'app.inventory_configurable_tax_accounts_rollback_authorized',
  'STAGING_20260923100000', true
);
${rollback}
DO $verify$
DECLARE v_source text;
BEGIN
  IF to_regprocedure('public.get_inventory_reconciliation_journal_plan_base_2da_fixed_tax(text,uuid,date)') IS NOT NULL
     OR to_regprocedure('public.fn_validate_company_tax_account_mapping()') IS NOT NULL
     OR to_regprocedure('public.fn_guard_configured_tax_account_shape()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger
       WHERE tgname IN ('trg_validate_company_tax_account_mapping',
         'trg_guard_configured_tax_account_shape') AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'STAGING_CONFIGURABLE_TAX_ROLLBACK_INCOMPLETE';
  END IF;
  v_source := pg_get_functiondef(
    'public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)'::regprocedure);
  IF v_source !~ '1105' OR v_source !~ '2102' THEN
    RAISE EXCEPTION 'STAGING_FIXED_TAX_BASE_NOT_RESTORED';
  END IF;
END;
$verify$;
SELECT '${rollbackMarker}' AS result;
ROLLBACK;
`, { mode: 0o600 });
  const rollbackOutput = runCli(explicitRollbackPath, logPath, "explicit-rollback");
  if (!rollbackOutput.includes(rollbackMarker)) {
    throw new Error(`لم تظهر علامة نجاح ملف الرجوع: ${logPath}`);
  }

  const after = extractNamedPayload(
    runCli(baselineAfterPath, logPath, "post-rollback-baseline"), "baseline");
  writeFileSync(join(reportDir, "actual-baseline-after.json"),
    `${JSON.stringify(after ?? null, null, 2)}\n`, { mode: 0o600 });
  validateBaseline(after);
  if (!sameBaseline(after, baseline)) {
    throw new Error(`لم تعد Staging إلى خط الأساس بعد ROLLBACK: ${logPath}`);
  }

  writeFileSync(reportPath, `${JSON.stringify({
    result: "STAGING_INVENTORY_CONFIGURABLE_TAX_REHEARSAL_OK",
    verifiedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    baselineArchive,
    scenarios: 8,
    purchaseInvoiceTaxMappingVerified: true,
    purchaseReturnTaxMappingVerified: true,
    salesInvoiceTaxMappingVerified: true,
    salesReturnTaxMappingVerified: true,
    invalidMappingGuardsVerified: true,
    configuredAccountFingerprintVerified: true,
    explicitRollbackVerified: true,
    baselineRestoredAfterRollback: true,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });

  console.log("نجحت تجربة حسابات الضريبة القابلة للتهيئة على Staging داخل معاملات انتهت بـ ROLLBACK كامل");
  console.log("نجحت السيناريوهات الثمانية وملف الرجوع، وعادت بيانات ومخطط Staging إلى خط الأساس");
  console.log("لم تُطبق Migration ولم تتغير أي بيئة إنتاجية");
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
