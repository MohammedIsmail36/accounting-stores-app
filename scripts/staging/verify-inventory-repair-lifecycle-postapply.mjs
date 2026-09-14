// Read-only verification after the permanent stage-2B Staging migration.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  requiredRepairFunctions,
  requiredRepairTables,
} from "../tests/rehearse-inventory-repair-lifecycle.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const baselinePath = "/tmp/staging-inventory-repair-before-20260914-081004/baseline.json";
const baselineManifestPath = "/tmp/staging-inventory-repair-before-20260914-081004/manifest.json";
const baselineArchive = "/backups/staging/inventory-repair-before-20260914-081004";
const cli = "supabase@2.116.0";

export function validatePostApplyVerifierSource(source) {
  for (const required of [
    expectedProjectRef,
    baselineArchive,
    "BEGIN TRANSACTION READ ONLY;",
    "ROLLBACK;",
    "STAGING_INVENTORY_REPAIR_LIFECYCLE_POST_APPLY_OK",
    "repair_migration_recorded",
    "row_level_security",
    "direct_dml_blocked",
  ]) {
    if (!source.includes(required)) throw new Error(`حاجز تحقق ما بعد التطبيق مفقود: ${required}`);
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
    throw new Error(`فشل تحقق 2B بعد التطبيق؛ التشخيص المحمي: ${logPath}`);
  }
  return JSON.parse(result.stdout);
}

function main() {
  if (process.argv.length > 2) throw new Error("هذا المشغل لا يقبل معاملات");
  validatePostApplyVerifierSource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  const linkedRef = readFileSync(projectRefPath, "utf8").trim();
  if (linkedRef !== expectedProjectRef) {
    throw new Error(`رفض التنفيذ: المشروع المرتبط ${linkedRef || "غير موجود"} ليس Staging المعتمد`);
  }

  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const manifest = JSON.parse(readFileSync(baselineManifestPath, "utf8"));
  const baselineSha = createHash("sha256").update(readFileSync(baselinePath)).digest("hex");
  if (manifest.files?.["baseline.json"]?.sha256 !== baselineSha) {
    throw new Error("بصمة خط الأساس لا تطابق النسخة المحفوظة");
  }

  const reportDir = mkdtempSync("/tmp/accounting-staging-inventory-repair-postapply-");
  const sqlPath = join(reportDir, "post-apply-verification.sql");
  const logPath = join(reportDir, "run.log");
  const reportPath = join(reportDir, "report.json");
  const functionSecurity = requiredRepairFunctions.map((signature, index) => `'function_${index + 1}',
      jsonb_build_object(
        'exists', to_regprocedure('${signature}') IS NOT NULL,
        'security_definer', COALESCE((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure('${signature}')), false),
        'safe_search_path', COALESCE((SELECT array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%'
          FROM pg_proc p WHERE p.oid = to_regprocedure('${signature}')), false),
        'anon_execute', has_function_privilege('anon', '${signature}', 'EXECUTE'),
        'authenticated_execute', has_function_privilege('authenticated', '${signature}', 'EXECUTE')
      )`).join(",\n      ");
  const tableSecurity = requiredRepairTables.map((name) => `'${name}',
      jsonb_build_object(
        'exists', to_regclass('public.${name}') IS NOT NULL,
        'row_level_security', COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.${name}')), false),
        'authenticated_select', has_table_privilege('authenticated', 'public.${name}', 'SELECT'),
        'direct_dml_blocked', NOT (
          has_table_privilege('authenticated', 'public.${name}', 'INSERT')
          OR has_table_privilege('authenticated', 'public.${name}', 'UPDATE')
          OR has_table_privilege('authenticated', 'public.${name}', 'DELETE')
        ),
        'rows', (SELECT count(*) FROM public.${name})
      )`).join(",\n      ");

  const sql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT jsonb_build_object(
  'result', 'STAGING_INVENTORY_REPAIR_LIFECYCLE_POST_APPLY_OK',
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'repair_migration_recorded', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260913234500'
  ),
  'tables', jsonb_build_object(${tableSecurity}),
  'functions', jsonb_build_object(${functionSecurity}),
  'internal_functions_hidden', NOT (
    has_function_privilege('authenticated', 'public.inventory_reconciliation_repair_require_actor(boolean)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.inventory_reconciliation_repair_result(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.inventory_reconciliation_repair_replay(uuid,text,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.inventory_reconciliation_replace_repair_items(uuid,jsonb)', 'EXECUTE')
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
  ),
  'diagnostic', public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)
) AS verification;
ROLLBACK;
`;
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  const response = runCli(sqlPath, logPath);
  const verification = response.rows?.[0]?.verification;
  if (!verification || verification.result !== "STAGING_INVENTORY_REPAIR_LIFECYCLE_POST_APPLY_OK"
      || verification.database !== "postgres" || verification.server_version !== "17.6"
      || !verification.repair_migration_recorded || !verification.internal_functions_hidden) {
    throw new Error(`فشل تحقق هوية أو سجل أو إخفاء دوال 2B؛ التشخيص المحمي: ${logPath}`);
  }
  for (const state of Object.values(verification.tables || {})) {
    if (!state.exists || !state.row_level_security || !state.authenticated_select
        || !state.direct_dml_blocked || state.rows !== 0) {
      throw new Error(`فشل تحقق جداول أو RLS أو منح 2B؛ التشخيص المحمي: ${logPath}`);
    }
  }
  for (const state of Object.values(verification.functions || {})) {
    if (!state.exists || !state.security_definer || !state.safe_search_path
        || state.anon_execute || !state.authenticated_execute) {
      throw new Error(`فشل تحقق دوال أو منح 2B؛ التشخيص المحمي: ${logPath}`);
    }
  }
  if (JSON.stringify(verification.counts) !== JSON.stringify(baseline.counts)
      || JSON.stringify(verification.signatures) !== JSON.stringify(baseline.signatures)
      || verification.diagnostic.fingerprint !== baseline.diagnostic.fingerprint
      || verification.diagnostic.status !== baseline.diagnostic.status) {
    throw new Error(`تغيرت بيانات الأعمال أو التشخيص عن خط الأساس؛ التشخيص المحمي: ${logPath}`);
  }

  writeFileSync(reportPath, `${JSON.stringify({
    result: verification.result,
    verifiedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    baselineArchive,
    migration: "20260913234500_inventory_reconciliation_repair_lifecycle.sql",
    repairTables: requiredRepairTables.length,
    repairFunctions: requiredRepairFunctions.length,
    repairRows: 0,
    rlsAndPrivilegesVerified: true,
    internalFunctionsHidden: true,
    businessBaselinePreserved: true,
    diagnosticPreserved: true,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجح التحقق الرسمي بعد تطبيق 2B على Staging");
  console.log("سجل الإصدار والجداول والدوال وRLS والمنح سليمة، وبيانات الأعمال والتشخيص مطابقان للنسخة");
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
