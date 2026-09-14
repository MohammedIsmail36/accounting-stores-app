// Transactional stage-2B rehearsal against the owned Staging project only.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  requiredRepairFunctions,
  requiredRepairTables,
  validateRepairLifecycleContractSql,
  validateRepairLifecycleMigrationSql,
} from "../tests/rehearse-inventory-repair-lifecycle.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const migrationPath = join(root, "supabase/migrations/20260913234500_inventory_reconciliation_repair_lifecycle.sql");
const contractPath = join(root, "supabase/tests/inventory_reconciliation_repair_lifecycle_contract.sql");
const baselinePath = "/tmp/staging-inventory-repair-before-20260914-081004/baseline.json";
const baselineManifestPath = "/tmp/staging-inventory-repair-before-20260914-081004/manifest.json";
const baselineArchive = "/backups/staging/inventory-repair-before-20260914-081004";
const cli = "supabase@2.116.0";
const marker = "INVENTORY_RECONCILIATION_REPAIR_LIFECYCLE_CONTRACT_OK";

export function validateStagingRepairRehearsalSource(source) {
  for (const required of [
    expectedProjectRef,
    baselinePath,
    baselineArchive,
    "BEGIN;",
    "ROLLBACK;",
    marker,
    "STAGING_REPAIR_LIFECYCLE_ROLLBACK_OK",
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

function runCli(filePath, logPath) {
  const result = spawnSync("npx", [
    "-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", filePath,
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    writeFileSync(logPath, output, { mode: 0o600 });
    throw new Error(`فشلت تجربة دورة المعالج على Staging؛ التشخيص المحمي: ${logPath}`);
  }
  return JSON.parse(result.stdout);
}

function stripL3OnlyContractParts(contract) {
  const withoutPsqlAndBegin = contract
    .replace(/^\\set ON_ERROR_STOP on\s*/m, "")
    .replace(/^BEGIN;\s*/m, "")
    .replace("current_database() <> 'l3_public_restore'", "current_database() <> 'postgres'");
  const withoutAuthMocks = withoutPsqlAndBegin.replace(
    /-- تحاكي L3 هوية الطلب[\s\S]*?CREATE TEMP TABLE repair_contract_ids/,
    "CREATE TEMP TABLE repair_contract_ids",
  );
  if (withoutAuthMocks.includes("CREATE OR REPLACE FUNCTION auth.role()")
      || withoutAuthMocks.includes("l3_public_restore")) {
    throw new Error("تعذر فصل محاكاة هوية L3 عن عقد Staging");
  }
  return withoutAuthMocks;
}

function verificationSql() {
  return `BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
  'result', 'STAGING_REPAIR_LIFECYCLE_ROLLBACK_OK',
  'repair_migration_recorded', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260913234500'
  ),
  'repair_objects', jsonb_build_object(
    ${requiredRepairTables.map((name) => `'${name}', to_regclass('public.${name}') IS NOT NULL`).join(",\n    ")},
    ${requiredRepairFunctions.map((signature, index) => `'function_${index + 1}', to_regprocedure('${signature}') IS NOT NULL`).join(",\n    ")}
  ),
  'counts', jsonb_build_object(
    'products', (SELECT count(*) FROM public.products),
    'inventory_movements', (SELECT count(*) FROM public.inventory_movements),
    'sales_invoices', (SELECT count(*) FROM public.sales_invoices),
    'purchase_invoices', (SELECT count(*) FROM public.purchase_invoices),
    'sales_returns', (SELECT count(*) FROM public.sales_returns),
    'purchase_returns', (SELECT count(*) FROM public.purchase_returns),
    'inventory_adjustments', (SELECT count(*) FROM public.inventory_adjustments),
    'journal_entries', (SELECT count(*) FROM public.journal_entries),
    'journal_entry_lines', (SELECT count(*) FROM public.journal_entry_lines)
  ),
  'signatures', jsonb_build_object(
    'products', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.products p),
    'inventory_movements', (SELECT md5(COALESCE(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id), '')) FROM public.inventory_movements m),
    'sales_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), '')) FROM public.sales_invoices s),
    'purchase_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.purchase_invoices p),
    'journal_entries', (SELECT md5(COALESCE(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id), '')) FROM public.journal_entries j),
    'journal_entry_lines', (SELECT md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), '')) FROM public.journal_entry_lines l)
  )
) AS verification;
ROLLBACK;
`;
}

function main() {
  if (process.argv.length > 2) throw new Error("هذا المشغل لا يقبل معاملات");
  validateStagingRepairRehearsalSource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  const linkedRef = readFileSync(projectRefPath, "utf8").trim();
  if (linkedRef !== expectedProjectRef) {
    throw new Error(`رفض التنفيذ: المشروع المرتبط ${linkedRef || "غير موجود"} ليس Staging المعتمد`);
  }

  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const baselineManifest = JSON.parse(readFileSync(baselineManifestPath, "utf8"));
  const baselineSha = createHash("sha256").update(readFileSync(baselinePath)).digest("hex");
  if (baselineManifest.files?.["baseline.json"]?.sha256 !== baselineSha
      || baselineManifest.result !== "STAGING_INVENTORY_REPAIR_BASELINE_BACKUP_OK") {
    throw new Error("بصمة خط أساس Staging المؤقت لا تطابق النسخة التي تم التحقق منها");
  }
  if (baseline.database !== "postgres" || baseline.server_version !== "17.6"
      || baseline.repair_migration_recorded
      || Object.values(baseline.repair_objects || {}).some(Boolean)) {
    throw new Error("خط أساس Staging غير صالح لتجربة 2B");
  }

  const migration = readFileSync(migrationPath, "utf8");
  const contract = readFileSync(contractPath, "utf8");
  validateRepairLifecycleMigrationSql(migration);
  validateRepairLifecycleContractSql(contract);
  const stagingContract = stripL3OnlyContractParts(contract);
  const reportDir = mkdtempSync("/tmp/accounting-staging-inventory-repair-lifecycle-");
  const rehearsalPath = join(reportDir, "rehearsal.sql");
  const verifyPath = join(reportDir, "verify-rollback.sql");
  const logPath = join(reportDir, "run.log");
  const reportPath = join(reportDir, "report.json");

  writeFileSync(rehearsalPath, `BEGIN;\n${migration}\n${stagingContract}`, { mode: 0o600 });
  writeFileSync(verifyPath, verificationSql(), { mode: 0o600 });
  const rehearsal = runCli(rehearsalPath, logPath);
  if (!JSON.stringify(rehearsal).includes(marker)) {
    throw new Error(`لم تظهر علامة نجاح عقد 2B؛ التشخيص المحمي: ${logPath}`);
  }

  const verificationResponse = runCli(verifyPath, logPath);
  const verification = verificationResponse.rows?.[0]?.verification;
  if (!verification || verification.result !== "STAGING_REPAIR_LIFECYCLE_ROLLBACK_OK") {
    throw new Error(`لم تظهر علامة نجاح الرجوع؛ التشخيص المحمي: ${logPath}`);
  }
  if (verification.repair_migration_recorded
      || Object.values(verification.repair_objects || {}).some(Boolean)) {
    throw new Error("بقيت مكونات 2B على Staging بعد ROLLBACK");
  }
  if (JSON.stringify(verification.counts) !== JSON.stringify(baseline.counts)
      || JSON.stringify(verification.signatures) !== JSON.stringify(baseline.signatures)) {
    throw new Error("تغيرت بيانات أعمال Staging عن خط الأساس بعد ROLLBACK");
  }

  writeFileSync(reportPath, `${JSON.stringify({
    result: "STAGING_INVENTORY_REPAIR_LIFECYCLE_REHEARSAL_OK",
    verifiedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    baseline: baselinePath,
    baselineArchive,
    migration: "20260913234500_inventory_reconciliation_repair_lifecycle.sql",
    scenarios: 16,
    migrationRolledBack: true,
    repairObjectsRemained: false,
    businessBaselinePreserved: true,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجحت تجربة دورة معالج المخزون على Staging وانتهت بـ ROLLBACK كامل");
  console.log("اختفت جداول ودوال 2B وتطابقت أعداد وبصمات بيانات الأعمال مع النسخة الحديثة");
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
