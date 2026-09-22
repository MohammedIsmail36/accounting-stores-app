// Read-only verification after permanently applying the stage 2D-C UI bridge on Staging.
import { createHash } from "node:crypto";
import { chownSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const baselineArchive = "/backups/staging/inventory-missing-journal-ui-bridge-before-20260922-070950/baseline";
const baselinePath = join(baselineArchive, "baseline.json");
const manifestPath = join(baselineArchive, "manifest.json");
const bridgeVersion = "20260922070000";
const bridgeSignature = "public.fn_prepare_inventory_missing_journal_repair_item()";
const cli = "supabase@2.116.0";

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") {
      throw new Error("شغّل الفاحص بواسطة sudo من حساب deploy فقط");
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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function equalJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function withoutKey(value, key) {
  const copy = { ...(value ?? {}) };
  delete copy[key];
  return copy;
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

function writeProtected(path, value) {
  writeFileSync(path, value, { mode: 0o600 });
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  if (Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) {
    chownSync(path, uid, gid);
  }
}

export function verificationSql(baselineSnapshot = "2026-09-22T07:12:02.668089+00:00") {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+00:00$/.test(baselineSnapshot)) {
    throw new Error("وقت خط الأساس غير صالح");
  }
  return `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT jsonb_build_object(
  'result', 'STAGING_INVENTORY_MISSING_JOURNAL_UI_BRIDGE_POST_APPLY_OK',
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'migration_recorded', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${bridgeVersion}'
  ),
  'bridge', jsonb_build_object(
    'function_exists', to_regprocedure('${bridgeSignature}') IS NOT NULL,
    'security_definer', COALESCE((SELECT p.prosecdef FROM pg_proc p
      WHERE p.oid = to_regprocedure('${bridgeSignature}')), false),
    'safe_search_path', COALESCE((SELECT 'search_path=public, pg_temp' = ANY(p.proconfig)
      FROM pg_proc p WHERE p.oid = to_regprocedure('${bridgeSignature}')), false),
    'public_execute', CASE WHEN to_regprocedure('${bridgeSignature}') IS NULL THEN true
      ELSE has_function_privilege('public', '${bridgeSignature}', 'EXECUTE') END,
    'anon_execute', CASE WHEN to_regprocedure('${bridgeSignature}') IS NULL THEN true
      ELSE has_function_privilege('anon', '${bridgeSignature}', 'EXECUTE') END,
    'authenticated_execute', CASE WHEN to_regprocedure('${bridgeSignature}') IS NULL THEN true
      ELSE has_function_privilege('authenticated', '${bridgeSignature}', 'EXECUTE') END,
    'trigger_count', (SELECT count(*) FROM pg_trigger
      WHERE tgrelid = 'public.inventory_reconciliation_repair_items'::regclass
        AND tgname = 'trg_prepare_inventory_missing_journal_repair_item'
        AND NOT tgisinternal AND tgenabled = 'O'),
    'uses_server_planner', position('get_inventory_reconciliation_journal_plan' IN
      pg_get_functiondef('${bridgeSignature}'::regprocedure)) > 0,
    'stores_plan_fingerprint', position('plan_fingerprint' IN
      pg_get_functiondef('${bridgeSignature}'::regprocedure)) > 0,
    'stores_correction_lines', position('correction_lines' IN
      pg_get_functiondef('${bridgeSignature}'::regprocedure)) > 0,
    'guards_accounting_date', position('REPAIR_ACCOUNTING_DATE_CONFLICT' IN
      pg_get_functiondef('${bridgeSignature}'::regprocedure)) > 0,
    'active_repairs', (SELECT count(*) FROM public.inventory_reconciliation_repair_items i
      JOIN public.inventory_reconciliation_repairs r ON r.id = i.repair_id
      WHERE i.repair_type = 'create_missing_inventory_journal'
        AND r.status IN ('draft', 'ready_for_review', 'approved'))
  ),
  'sales_invoice_audit_since_baseline', jsonb_build_object(
    'rows', (SELECT count(*) FROM public.audit_log
      WHERE table_name = 'sales_invoices'
        AND created_at > '${baselineSnapshot}'::timestamptz),
    'timestamp_only_changes', (SELECT count(*) FROM public.audit_log
      WHERE table_name = 'sales_invoices'
        AND created_at > '${baselineSnapshot}'::timestamptz
        AND old_data IS NOT NULL AND new_data IS NOT NULL
        AND (old_data - 'updated_at') IS NOT DISTINCT FROM (new_data - 'updated_at')
        AND old_data->>'updated_at' IS DISTINCT FROM new_data->>'updated_at'),
    'business_changes', (SELECT count(*) FROM public.audit_log
      WHERE table_name = 'sales_invoices'
        AND created_at > '${baselineSnapshot}'::timestamptz
        AND (old_data IS NULL OR new_data IS NULL
          OR (old_data - 'updated_at') IS DISTINCT FROM (new_data - 'updated_at')))
  ),
  'counts', jsonb_build_object(
    'products', (SELECT count(*) FROM public.products),
    'inventory_movements', (SELECT count(*) FROM public.inventory_movements),
    'sales_invoices', (SELECT count(*) FROM public.sales_invoices),
    'sales_returns', (SELECT count(*) FROM public.sales_returns),
    'purchase_invoices', (SELECT count(*) FROM public.purchase_invoices),
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
    'sales_returns', (SELECT md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), '')) FROM public.sales_returns s),
    'purchase_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.purchase_invoices p),
    'purchase_returns', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.purchase_returns p),
    'inventory_adjustments', (SELECT md5(COALESCE(string_agg(to_jsonb(a)::text, '|' ORDER BY a.id), '')) FROM public.inventory_adjustments a),
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

export function validateSource(source) {
  for (const required of [
    expectedProjectRef,
    baselineArchive,
    bridgeVersion,
    bridgeSignature,
    "BEGIN TRANSACTION READ ONLY;",
    "ROLLBACK;",
    "STAGING_INVENTORY_MISSING_JOURNAL_UI_BRIDGE_POST_APPLY_OK",
  ]) {
    if (!source.includes(required)) throw new Error(`حاجز تحقق جسر 2D-C مفقود: ${required}`);
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

function runCli(sqlPath, logPath) {
  const result = spawnSync("npx", [
    "-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", sqlPath,
  ], {
    cwd: root,
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 96 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    writeProtected(logPath, `${output}\n${result.error?.stack ?? ""}`);
    throw new Error(`فشل تحقق جسر 2D-C بعد التطبيق؛ التشخيص المحمي: ${logPath}`);
  }
  return result.stdout;
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا الفاحص لا يقبل معاملات");
  validateSource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.result !== "STAGING_INVENTORY_MISSING_JOURNAL_UI_BRIDGE_BASELINE_OK"
      || manifest.projectRef !== expectedProjectRef
      || manifest.files?.["baseline.json"]?.sha256 !== sha256(baselinePath)) {
    throw new Error("بصمة خط أساس جسر 2D-C غير صالحة");
  }

  const reportDir = mkdtempSync("/tmp/accounting-staging-inventory-missing-journal-ui-bridge-postapply-");
  const sqlPath = join(reportDir, "post-apply-verification.sql");
  const logPath = join(reportDir, "run.log");
  const reportPath = join(reportDir, "report.json");
  writeProtected(sqlPath, verificationSql(baseline.diagnostic?.snapshot_at));
  const verification = extract(runCli(sqlPath, logPath), "verification");
  const bridge = verification?.bridge ?? {};
  const audit = verification?.sales_invoice_audit_since_baseline ?? {};
  const nonSalesSignaturesMatch = equalJson(
    withoutKey(verification.signatures, "sales_invoices"),
    withoutKey(baseline.signatures, "sales_invoices"),
  );
  const salesSignatureSafe = verification?.signatures?.sales_invoices === baseline?.signatures?.sales_invoices
    || (audit.rows > 0 && audit.timestamp_only_changes === audit.rows && audit.business_changes === 0);
  const valid = verification?.result === "STAGING_INVENTORY_MISSING_JOURNAL_UI_BRIDGE_POST_APPLY_OK"
    && verification?.database === "postgres"
    && verification?.server_version?.startsWith("17.")
    && verification?.migration_recorded === true
    && bridge.function_exists === true
    && bridge.security_definer === true
    && bridge.safe_search_path === true
    && bridge.public_execute === false
    && bridge.anon_execute === false
    && bridge.authenticated_execute === false
    && bridge.trigger_count === 1
    && bridge.uses_server_planner === true
    && bridge.stores_plan_fingerprint === true
    && bridge.stores_correction_lines === true
    && bridge.guards_accounting_date === true
    && bridge.active_repairs === 0
    && equalJson(verification.counts, baseline.counts)
    && nonSalesSignaturesMatch
    && salesSignatureSafe
    && equalJson(stableDiagnostic(verification.diagnostic), stableDiagnostic(baseline.diagnostic));
  if (!valid) {
    writeProtected(logPath, `${JSON.stringify({ baseline, verification }, null, 2)}\n`);
    throw new Error(`فشل تحقق جسر 2D-C أو تغير خط الأساس؛ التشخيص المحمي: ${logPath}`);
  }

  writeProtected(reportPath, `${JSON.stringify({
    result: verification.result,
    verifiedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    baselineArchive,
    migration: bridgeVersion,
    migrationRecorded: true,
    functionTriggerAndPrivilegesVerified: true,
    serverDerivedPlanVerified: true,
    timestampOnlySalesInvoiceChangesAccepted: audit.timestamp_only_changes,
    businessSalesInvoiceChangesDetected: audit.business_changes,
    businessRepairAndDiagnosticBaselinePreserved: true,
    productionModified: false,
  }, null, 2)}\n`);
  console.log("نجح التحقق الرسمي بعد تطبيق جسر 2D-C على Staging");
  console.log("الدالة والمشغل والصلاحيات وخطة الخادم سليمة، وبيانات الأعمال والتشخيص مطابقة للنسخة");
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
