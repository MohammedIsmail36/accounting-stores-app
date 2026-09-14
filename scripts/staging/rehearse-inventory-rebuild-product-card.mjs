// Transactional rehearsal of stage 2C against the owned Staging project only.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateRebuildContractSql,
  validateRebuildMigrationSql,
  validateRebuildRollbackSql,
} from "../tests/rehearse-inventory-rebuild-product-card.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const migrationPath = join(root, "supabase/migrations/20260914190000_inventory_reconciliation_rebuild_product_card_executor.sql");
const rollbackPath = join(root, "supabase/rollback/20260914190000_inventory_reconciliation_rebuild_product_card_executor.sql");
const contractPath = join(root, "supabase/tests/inventory_reconciliation_rebuild_product_card_contract.sql");
const baselineDir = "/tmp/staging-inventory-rebuild-before-20260914-190747";
const baselinePath = join(baselineDir, "baseline.json");
const baselineManifestPath = join(baselineDir, "manifest.json");
const baselineArchive = "/backups/staging/inventory-rebuild-before-20260914-190747";
const cli = "supabase@2.116.0";
const executorVersion = "20260914190000";
const contractMarker = "INVENTORY_RECONCILIATION_REBUILD_PRODUCT_CARD_CONTRACT_OK";
const rollbackMarker = "STAGING_INVENTORY_REBUILD_EXPLICIT_ROLLBACK_OK";

export function validateStagingRebuildRehearsalSource(source) {
  for (const required of [
    expectedProjectRef,
    baselineDir,
    baselineArchive,
    "BEGIN;",
    "ROLLBACK;",
    contractMarker,
    rollbackMarker,
    executorVersion,
  ]) {
    if (!source.includes(required)) throw new Error(`حاجز تجربة Staging مفقود: ${required}`);
  }
  for (const forbidden of [
    ["farida", "-db"].join(""),
    ["alibea", "-db"].join(""),
    ["farida", ".alibea2020.com"].join(""),
    ["alibea", ".alibea2020.com"].join(""),
  ]) {
    if (source.includes(forbidden)) throw new Error(`وجهة إنتاجية ممنوعة: ${forbidden}`);
  }
}

function runCli(filePath, logPath, label) {
  const result = spawnSync("npx", [
    "-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", filePath,
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    writeFileSync(logPath, `${label}\n${output}\n${result.error?.stack ?? ""}`, { mode: 0o600 });
    throw new Error(`فشلت تجربة 2C على Staging (${label})؛ التشخيص المحمي: ${logPath}`);
  }
  return result.stdout;
}

function stripL3OnlyContractParts(contract) {
  const staging = contract
    .replace(/^\\set ON_ERROR_STOP on\s*/m, "")
    .replace(/^BEGIN;\s*/m, "")
    .replace("current_database() <> 'l3_public_restore'", "current_database() <> 'postgres'")
    .replace(
      /CREATE OR REPLACE FUNCTION auth\.role\(\)[\s\S]*?\$\$;\s*CREATE OR REPLACE FUNCTION auth\.uid\(\)[\s\S]*?\$\$;\s*/,
      "",
    );
  if (staging.includes("CREATE OR REPLACE FUNCTION auth.role()")
      || staging.includes("CREATE OR REPLACE FUNCTION auth.uid()")
      || staging.includes("l3_public_restore")) {
    throw new Error("تعذر فصل محاكاة هوية L3 عن عقد Staging");
  }
  return staging;
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

function verificationSql() {
  return `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT jsonb_build_object(
  'result', 'STAGING_INVENTORY_REBUILD_BASELINE_VERIFICATION_OK',
  'executor_migration_recorded', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${executorVersion}'
  ),
  'executor_enabled', position('product_card_rebuilt' IN pg_get_functiondef(
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
  )) > 0,
  'executor_guarded', position('REPAIR_TYPE_NOT_ENABLED' IN pg_get_functiondef(
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
  )) > 0,
  'counts', jsonb_build_object(
    'products', (SELECT count(*) FROM public.products),
    'inventory_movements', (SELECT count(*) FROM public.inventory_movements),
    'sales_invoices', (SELECT count(*) FROM public.sales_invoices),
    'purchase_invoices', (SELECT count(*) FROM public.purchase_invoices),
    'sales_returns', (SELECT count(*) FROM public.sales_returns),
    'purchase_returns', (SELECT count(*) FROM public.purchase_returns),
    'inventory_adjustments', (SELECT count(*) FROM public.inventory_adjustments),
    'journal_entries', (SELECT count(*) FROM public.journal_entries),
    'journal_entry_lines', (SELECT count(*) FROM public.journal_entry_lines),
    'repairs', (SELECT count(*) FROM public.inventory_reconciliation_repairs),
    'repair_items', (SELECT count(*) FROM public.inventory_reconciliation_repair_items),
    'repair_effects', (SELECT count(*) FROM public.inventory_reconciliation_repair_effects),
    'repair_events', (SELECT count(*) FROM public.inventory_reconciliation_repair_events)
  ),
  'signatures', jsonb_build_object(
    'products', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.products p),
    'inventory_movements', (SELECT md5(COALESCE(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id), '')) FROM public.inventory_movements m),
    'sales_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), '')) FROM public.sales_invoices s),
    'purchase_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.purchase_invoices p),
    'journal_entries', (SELECT md5(COALESCE(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id), '')) FROM public.journal_entries j),
    'journal_entry_lines', (SELECT md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), '')) FROM public.journal_entry_lines l),
    'repairs', (SELECT md5(COALESCE(string_agg(to_jsonb(r)::text, '|' ORDER BY r.id), '')) FROM public.inventory_reconciliation_repairs r),
    'repair_items', (SELECT md5(COALESCE(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id), '')) FROM public.inventory_reconciliation_repair_items i),
    'repair_effects', (SELECT md5(COALESCE(string_agg(to_jsonb(e)::text, '|' ORDER BY e.id), '')) FROM public.inventory_reconciliation_repair_effects e),
    'repair_events', (SELECT md5(COALESCE(string_agg(to_jsonb(e)::text, '|' ORDER BY e.id), '')) FROM public.inventory_reconciliation_repair_events e)
  ),
  'diagnostic', public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)
) AS verification;
ROLLBACK;
`;
}

function main() {
  if (process.argv.length > 2) throw new Error("هذا المشغل لا يقبل معاملات");
  validateStagingRebuildRehearsalSource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  const linkedRef = readFileSync(projectRefPath, "utf8").trim();
  if (linkedRef !== expectedProjectRef) {
    throw new Error(`رفض التنفيذ: المشروع المرتبط ${linkedRef || "غير موجود"} ليس Staging المعتمد`);
  }

  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const manifest = JSON.parse(readFileSync(baselineManifestPath, "utf8"));
  const baselineSha = createHash("sha256").update(readFileSync(baselinePath)).digest("hex");
  if (manifest.result !== "STAGING_INVENTORY_REBUILD_BASELINE_BACKUP_OK"
      || manifest.files?.["baseline.json"]?.sha256 !== baselineSha
      || manifest.projectRef !== expectedProjectRef
      || baseline.executor_migration_recorded
      || baseline.executor_enabled
      || !baseline.executor_guarded) {
    throw new Error("خط أساس Staging قبل 2C غير صالح أو تغيرت بصمته");
  }

  const migration = readFileSync(migrationPath, "utf8");
  const rollback = readFileSync(rollbackPath, "utf8");
  const contract = readFileSync(contractPath, "utf8");
  validateRebuildMigrationSql(migration);
  validateRebuildRollbackSql(rollback);
  validateRebuildContractSql(contract);
  const stagingContract = stripL3OnlyContractParts(contract);

  const reportDir = mkdtempSync("/tmp/accounting-staging-inventory-rebuild-rehearsal-");
  const rehearsalPath = join(reportDir, "rehearsal.sql");
  const rollbackPathGenerated = join(reportDir, "explicit-rollback.sql");
  const verificationPath = join(reportDir, "post-rollback-verification.sql");
  const logPath = join(reportDir, "run.log");
  const reportPath = join(reportDir, "report.json");

  writeFileSync(rehearsalPath, `BEGIN;\n${migration}\n${stagingContract}`, { mode: 0o600 });
  writeFileSync(rollbackPathGenerated, `BEGIN;
${migration}
SELECT set_config('app.inventory_rebuild_rollback_authorized', 'STAGING_20260914190000', true);
${rollback}
DO $verify$
BEGIN
  IF position('REPAIR_TYPE_NOT_ENABLED' IN pg_get_functiondef(
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
  )) = 0 OR position('product_card_rebuilt' IN pg_get_functiondef(
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
  )) > 0 THEN
    RAISE EXCEPTION 'STAGING_INVENTORY_REBUILD_ROLLBACK_FAILED';
  END IF;
END;
$verify$;
SELECT '${rollbackMarker}';
ROLLBACK;
`, { mode: 0o600 });
  writeFileSync(verificationPath, verificationSql(), { mode: 0o600 });

  const rehearsalOutput = runCli(rehearsalPath, logPath, "migration-contract");
  if (!rehearsalOutput.includes(contractMarker)) {
    throw new Error(`لم تظهر علامة نجاح سيناريوهات 2C؛ التشخيص المحمي: ${logPath}`);
  }
  const rollbackOutput = runCli(rollbackPathGenerated, logPath, "explicit-rollback");
  if (!rollbackOutput.includes(rollbackMarker)) {
    throw new Error(`لم تظهر علامة نجاح ملف الرجوع؛ التشخيص المحمي: ${logPath}`);
  }
  const verificationOutput = runCli(verificationPath, logPath, "post-rollback-verification");
  const parsed = JSON.parse(verificationOutput);
  const verification = parsed.rows?.[0]?.verification;
  if (!verification
      || verification.result !== "STAGING_INVENTORY_REBUILD_BASELINE_VERIFICATION_OK"
      || verification.executor_migration_recorded
      || verification.executor_enabled
      || !verification.executor_guarded
      || JSON.stringify(verification.counts) !== JSON.stringify(baseline.counts)
      || JSON.stringify(verification.signatures) !== JSON.stringify(baseline.signatures)
      || JSON.stringify(stableDiagnostic(verification.diagnostic))
        !== JSON.stringify(stableDiagnostic(baseline.diagnostic))) {
    throw new Error(`لم تعد Staging إلى خط الأساس بعد التجربة؛ التشخيص المحمي: ${logPath}`);
  }

  writeFileSync(reportPath, `${JSON.stringify({
    result: "STAGING_INVENTORY_REBUILD_TRANSACTIONAL_REHEARSAL_OK",
    verifiedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    baseline: baselinePath,
    baselineArchive,
    migration: migrationPath.split("/").at(-1),
    rollback: rollbackPath.split("/").at(-1),
    scenarios: 10,
    contractRolledBack: true,
    explicitRollbackVerified: true,
    executorRemainedGuarded: true,
    businessAndRepairBaselinePreserved: true,
    diagnosticPreserved: true,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });

  console.log("نجحت تجربة منفذ 2C على Staging داخل معاملات انتهت بـ ROLLBACK كامل");
  console.log("نجح ملف الرجوع وعاد حاجز 2B، وتطابقت بيانات الأعمال والمعالجات والتشخيص مع خط الأساس");
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
