// Read-only verification after permanently applying the stage-2C executor on Staging.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const baselineDir = "/tmp/staging-inventory-rebuild-before-20260914-190747";
const baselinePath = join(baselineDir, "baseline.json");
const baselineManifestPath = join(baselineDir, "manifest.json");
const baselineArchive = "/backups/staging/inventory-rebuild-before-20260914-190747";
const executorVersion = "20260914190000";
const executorSignature = "public.execute_inventory_reconciliation_repair(uuid,integer,uuid)";
const cli = "supabase@2.116.0";

export function validateRebuildPostApplySource(source) {
  for (const required of [
    expectedProjectRef,
    baselineDir,
    baselineArchive,
    executorVersion,
    "BEGIN TRANSACTION READ ONLY;",
    "ROLLBACK;",
    "STAGING_INVENTORY_REBUILD_POST_APPLY_OK",
    "product_card_rebuilt",
    "REPAIR_TYPE_NOT_ENABLED",
  ]) {
    if (!source.includes(required)) throw new Error(`حاجز تحقق ما بعد تطبيق 2C مفقود: ${required}`);
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
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    writeFileSync(logPath, output, { mode: 0o600 });
    throw new Error(`فشل تحقق 2C بعد التطبيق؛ التشخيص المحمي: ${logPath}`);
  }
  return JSON.parse(result.stdout);
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

function main() {
  if (process.argv.length > 2) throw new Error("هذا المشغل لا يقبل معاملات");
  validateRebuildPostApplySource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  const linkedRef = readFileSync(projectRefPath, "utf8").trim();
  if (linkedRef !== expectedProjectRef) {
    throw new Error(`رفض التنفيذ: المشروع المرتبط ${linkedRef || "غير موجود"} ليس Staging المعتمد`);
  }

  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const manifest = JSON.parse(readFileSync(baselineManifestPath, "utf8"));
  const baselineSha = createHash("sha256").update(readFileSync(baselinePath)).digest("hex");
  if (manifest.result !== "STAGING_INVENTORY_REBUILD_BASELINE_BACKUP_OK"
      || manifest.files?.["baseline.json"]?.sha256 !== baselineSha
      || manifest.projectRef !== expectedProjectRef) {
    throw new Error("بصمة خط أساس Staging قبل 2C غير صالحة");
  }

  const reportDir = mkdtempSync("/tmp/accounting-staging-inventory-rebuild-postapply-");
  const sqlPath = join(reportDir, "post-apply-verification.sql");
  const logPath = join(reportDir, "run.log");
  const reportPath = join(reportDir, "report.json");
  const sql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT jsonb_build_object(
  'result', 'STAGING_INVENTORY_REBUILD_POST_APPLY_OK',
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'executor_migration_recorded', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${executorVersion}'
  ),
  'executor_enabled', position('product_card_rebuilt' IN pg_get_functiondef(
    '${executorSignature}'::regprocedure
  )) > 0,
  'unsupported_types_guarded', position('REPAIR_TYPE_NOT_ENABLED' IN pg_get_functiondef(
    '${executorSignature}'::regprocedure
  )) > 0,
  'function_security', jsonb_build_object(
    'security_definer', COALESCE((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure('${executorSignature}')), false),
    'safe_search_path', COALESCE((SELECT array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%'
      FROM pg_proc p WHERE p.oid = to_regprocedure('${executorSignature}')), false),
    'anon_execute', has_function_privilege('anon', '${executorSignature}', 'EXECUTE'),
    'authenticated_execute', has_function_privilege('authenticated', '${executorSignature}', 'EXECUTE')
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
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  const response = runCli(sqlPath, logPath);
  const verification = response.rows?.[0]?.verification;
  const security = verification?.function_security;
  if (!verification
      || verification.result !== "STAGING_INVENTORY_REBUILD_POST_APPLY_OK"
      || verification.database !== "postgres"
      || verification.server_version !== "17.6"
      || !verification.executor_migration_recorded
      || !verification.executor_enabled
      || !verification.unsupported_types_guarded
      || !security?.security_definer
      || !security?.safe_search_path
      || security?.anon_execute
      || !security?.authenticated_execute
      || JSON.stringify(verification.counts) !== JSON.stringify(baseline.counts)
      || JSON.stringify(verification.signatures) !== JSON.stringify(baseline.signatures)
      || JSON.stringify(stableDiagnostic(verification.diagnostic))
        !== JSON.stringify(stableDiagnostic(baseline.diagnostic))) {
    throw new Error(`فشل تحقق تفعيل 2C أو تغير خط الأساس؛ التشخيص المحمي: ${logPath}`);
  }

  writeFileSync(reportPath, `${JSON.stringify({
    result: verification.result,
    verifiedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    baselineArchive,
    migration: "20260914190000_inventory_reconciliation_rebuild_product_card_executor.sql",
    executorMigrationRecorded: true,
    executorEnabled: true,
    unsupportedTypesGuarded: true,
    functionSecurityVerified: true,
    businessAndRepairBaselinePreserved: true,
    diagnosticPreserved: true,
    repairEffects: verification.counts.repair_effects,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });

  console.log("نجح التحقق الرسمي بعد تطبيق منفذ 2C على Staging");
  console.log("الإصدار والدالة والصلاحيات سليمة، وبيانات الأعمال والمعالجات والتشخيص مطابقة للنسخة");
  console.log(`REPAIR_EFFECTS=${verification.counts.repair_effects}`);
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
