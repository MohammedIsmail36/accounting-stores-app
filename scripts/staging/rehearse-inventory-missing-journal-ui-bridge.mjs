// Transactional rehearsal of the stage 2D-C UI bridge against Staging only.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateUiBridgeContract,
  validateUiBridgeMigration,
  validateUiBridgeRollback,
} from "../tests/rehearse-inventory-missing-journal-ui-bridge.mjs";
import { baselineSql } from "./backup-inventory-missing-journal-ui-bridge-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const migrationPath = join(root,
  "supabase/migrations/20260922070000_inventory_reconciliation_missing_journal_ui_bridge.sql");
const rollbackPath = join(root,
  "supabase/rollback/20260922070000_inventory_reconciliation_missing_journal_ui_bridge.sql");
const contractPath = join(root,
  "supabase/tests/inventory_reconciliation_missing_journal_ui_bridge_contract.sql");
const executorContractPath = join(root,
  "supabase/tests/inventory_reconciliation_missing_journal_executor_contract.sql");
const cli = "supabase@2.116.0";
const marker = "INVENTORY_RECONCILIATION_MISSING_JOURNAL_UI_BRIDGE_CONTRACT_OK";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function runCli(filePath, logPath, label) {
  const result = spawnSync("npx", [
    "-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", filePath,
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 420000,
    maxBuffer: 96 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    writeFileSync(logPath, `${label}\n${output}\n${result.error?.stack ?? ""}`, { mode: 0o600 });
    throw new Error(`فشلت تجربة جسر 2D على Staging (${label}): ${logPath}`);
  }
  return result.stdout;
}

function extract(output, name) {
  const parsed = JSON.parse(output);
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

function sameBaseline(actual, expected) {
  return JSON.stringify(canonical(actual?.counts)) === JSON.stringify(canonical(expected.counts))
    && JSON.stringify(canonical(actual?.signatures)) === JSON.stringify(canonical(expected.signatures))
    && JSON.stringify(canonical(stableDiagnostic(actual?.diagnostic)))
      === JSON.stringify(canonical(stableDiagnostic(expected.diagnostic)));
}

function stagingFixturePrelude() {
  const source = readFileSync(executorContractPath, "utf8");
  const end = source.indexOf("-- Scenario 01:");
  if (end < 0) throw new Error("تعذر استخراج تجهيزات عقد 2D");
  const staging = source.slice(0, end)
    .replace(/^\\set ON_ERROR_STOP on\s*/m, "")
    .replace(/^BEGIN;\s*/m, "")
    .replace("current_database() <> 'l3_public_restore'", "current_database() <> 'postgres'")
    .replace(
      /CREATE OR REPLACE FUNCTION auth\.role\(\)[\s\S]*?\$\$;\s*CREATE OR REPLACE FUNCTION auth\.uid\(\)[\s\S]*?\$\$;\s*/,
      "",
    );
  if (staging.includes("l3_public_restore") || staging.includes("CREATE OR REPLACE FUNCTION auth.")) {
    throw new Error("تعذر فصل محاكاة هوية L3 عن تجهيز Staging");
  }
  return staging;
}

function main() {
  if (process.argv.length !== 3) {
    throw new Error("استخدم: rehearse-inventory-missing-journal-ui-bridge.mjs <baseline-dir>");
  }
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }
  const baselineDir = resolve(process.argv[2]);
  if (!baselineDir.startsWith("/tmp/staging-inventory-missing-journal-ui-bridge-before-")) {
    throw new Error("مسار خط الأساس غير معتمد");
  }
  const baselinePath = join(baselineDir, "baseline.json");
  const manifestPath = join(baselineDir, "manifest.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.result !== "STAGING_INVENTORY_MISSING_JOURNAL_UI_BRIDGE_BASELINE_OK"
      || manifest.projectRef !== expectedProjectRef
      || manifest.files?.["baseline.json"]?.sha256 !== sha256(baselinePath)) {
    throw new Error("خط أساس جسر 2D غير صالح أو تغيرت بصمته");
  }

  const migration = readFileSync(migrationPath, "utf8");
  const rollback = readFileSync(rollbackPath, "utf8");
  const contract = readFileSync(contractPath, "utf8");
  validateUiBridgeMigration(migration);
  validateUiBridgeRollback(rollback);
  validateUiBridgeContract(contract);
  const stagingContract = contract.replace(
    "current_database() <> 'l3_public_restore'", "current_database() <> 'postgres'");

  const reportDir = mkdtempSync("/tmp/accounting-staging-inventory-missing-journal-ui-bridge-rehearsal-");
  const preflightPath = join(reportDir, "baseline-verification.sql");
  const rehearsalPath = join(reportDir, "bridge-rehearsal.sql");
  const rollbackPathOut = join(reportDir, "explicit-rollback.sql");
  const logPath = join(reportDir, "run.log");
  writeFileSync(preflightPath, baselineSql, { mode: 0o600 });
  const preflight = extract(runCli(preflightPath, logPath, "baseline-preflight"), "baseline");
  if (!sameBaseline(preflight, baseline)
      || preflight?.migration_state?.bridge || preflight?.bridge_state?.function_exists
      || preflight?.bridge_state?.trigger_count !== 0 || preflight?.bridge_state?.active_repairs !== 0) {
    throw new Error(`تغيرت Staging منذ النسخة؛ ألغيت التجربة: ${logPath}`);
  }

  writeFileSync(rehearsalPath,
    `BEGIN;\n${migration}\n${stagingFixturePrelude()}\n${stagingContract}`,
    { mode: 0o600 });
  const rehearsalOutput = runCli(rehearsalPath, logPath, "bridge-contract");
  if (!rehearsalOutput.includes(marker)) throw new Error(`لم تظهر علامة نجاح الجسر: ${logPath}`);

  writeFileSync(rollbackPathOut, `BEGIN;
${migration}
SELECT set_config('app.inventory_missing_journal_ui_bridge_rollback_authorized',
  'STAGING_20260922070000', true);
${rollback}
DO $verify$
BEGIN
  IF to_regprocedure('public.fn_prepare_inventory_missing_journal_repair_item()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.inventory_reconciliation_repair_items'::regclass
         AND tgname = 'trg_prepare_inventory_missing_journal_repair_item' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'STAGING_2D_UI_BRIDGE_ROLLBACK_FAILED';
  END IF;
END;
$verify$;
SELECT 'STAGING_2D_UI_BRIDGE_EXPLICIT_ROLLBACK_OK';
ROLLBACK;`, { mode: 0o600 });
  const rollbackOutput = runCli(rollbackPathOut, logPath, "explicit-rollback");
  if (!rollbackOutput.includes("STAGING_2D_UI_BRIDGE_EXPLICIT_ROLLBACK_OK")) {
    throw new Error(`لم تظهر علامة نجاح الرجوع: ${logPath}`);
  }
  const after = extract(runCli(preflightPath, logPath, "post-rollback-baseline"), "baseline");
  if (!sameBaseline(after, baseline) || after?.migration_state?.bridge
      || after?.bridge_state?.function_exists || after?.bridge_state?.trigger_count !== 0) {
    throw new Error(`لم تعد Staging إلى خط الأساس: ${logPath}`);
  }
  const reportPath = join(reportDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify({
    result: "STAGING_INVENTORY_MISSING_JOURNAL_UI_BRIDGE_REHEARSAL_OK",
    verifiedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    baselineDir,
    scenarios: 7,
    contractRolledBack: true,
    explicitRollbackVerified: true,
    businessRepairAndDiagnosticBaselinePreserved: true,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجحت تجربة جسر واجهة 2D على Staging داخل معاملات انتهت بـ ROLLBACK كامل");
  console.log("نجحت السيناريوهات السبعة والرجوع الصريح، وتطابق خط الأساس بعد التجربة");
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
