// Read-only verification after permanently applying the protected 2D bundle on Staging.
import { createHash } from "node:crypto";
import { chownSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const baselineArchive = "/backups/staging/inventory-missing-journal-before-20260922-012321";
const baselinePath = join(baselineArchive, "baseline.json");
const manifestPath = join(baselineArchive, "manifest.json");
const cli = "supabase@2.116.0";
const versions = ["20260921213000", "20260921220000", "20260921233000"];
const plannerSignature = "public.get_inventory_reconciliation_journal_plan(text,uuid,date)";
const plannerBaseSignature = "public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)";
const executorSignature = "public.execute_inventory_reconciliation_repair(uuid,integer,uuid)";
const rebuildSignature = "public.execute_inventory_reconciliation_repair_rebuild_2c(uuid,integer,uuid)";

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

function writeDiagnostic(path, message) {
  writeFileSync(path, message, { mode: 0o600 });
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  if (Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) {
    chownSync(path, uid, gid);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function equalJson(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
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

function extractNamedPayload(output, name) {
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

function functionState(signature) {
  return `jsonb_build_object(
    'exists', to_regprocedure('${signature}') IS NOT NULL,
    'security_definer', COALESCE((SELECT p.prosecdef FROM pg_proc p
      WHERE p.oid = to_regprocedure('${signature}')), false),
    'safe_search_path', COALESCE((SELECT array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%'
      FROM pg_proc p WHERE p.oid = to_regprocedure('${signature}')), false),
    'anon_execute', CASE WHEN to_regprocedure('${signature}') IS NULL THEN true
      ELSE has_function_privilege('anon', '${signature}', 'EXECUTE') END,
    'authenticated_execute', CASE WHEN to_regprocedure('${signature}') IS NULL THEN false
      ELSE has_function_privilege('authenticated', '${signature}', 'EXECUTE') END
  )`;
}

export function verificationSql() {
  return `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT jsonb_build_object(
  'result', 'STAGING_INVENTORY_MISSING_JOURNAL_POST_APPLY_OK',
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'migration_state', jsonb_build_object(
    'system_accounts', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${versions[0]}'),
    'planner_2da', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${versions[1]}'),
    'executor_2db', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${versions[2]}')
  ),
  'account_state', COALESCE((SELECT jsonb_object_agg(a.code, jsonb_build_object(
      'count', a.account_count,
      'type', a.account_type,
      'parent_code', a.parent_code,
      'is_parent', a.is_parent,
      'is_active', a.is_active,
      'is_system', a.is_system
    ) ORDER BY a.code)
    FROM (
      SELECT child.code, count(*) AS account_count, min(child.account_type) AS account_type,
        min(parent.code) AS parent_code, bool_or(child.is_parent) AS is_parent,
        bool_and(child.is_active) AS is_active, bool_and(child.is_system) AS is_system
      FROM public.accounts child
      LEFT JOIN public.accounts parent ON parent.id = child.parent_id
      WHERE child.code IN ('4201', '5201')
      GROUP BY child.code
    ) a), '{}'::jsonb),
  'guard_state', jsonb_build_object(
    'function_exists', to_regprocedure('public.fn_guard_system_accounts_delete()') IS NOT NULL,
    'trigger_count', (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.accounts'::regclass
      AND tgname = 'trg_guard_system_accounts_delete' AND NOT tgisinternal)
  ),
  'functions', jsonb_build_object(
    'planner', ${functionState(plannerSignature)},
    'planner_base', ${functionState(plannerBaseSignature)},
    'executor', ${functionState(executorSignature)},
    'rebuild', ${functionState(rebuildSignature)}
  ),
  'executor_guards', jsonb_build_object(
    'missing_journal_enabled', position('missing_inventory_journal_created' IN pg_get_functiondef(
      '${executorSignature}'::regprocedure)) > 0,
    'rebuild_preserved', position('product_card_rebuilt' IN pg_get_functiondef(
      '${rebuildSignature}'::regprocedure)) > 0,
    'mapping_validation', position('ACCOUNT_MAPPING_INVALID' IN pg_get_functiondef(
      '${plannerBaseSignature}'::regprocedure)) > 0
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

export function validatePostApplySource(source) {
  for (const required of [
    expectedProjectRef,
    baselineArchive,
    "BEGIN TRANSACTION READ ONLY;",
    "ROLLBACK;",
    "STAGING_INVENTORY_MISSING_JOURNAL_POST_APPLY_OK",
    ...versions,
    "fn_guard_system_accounts_delete",
    "ACCOUNT_MAPPING_INVALID",
    "missing_inventory_journal_created",
  ]) {
    if (!source.includes(required)) throw new Error(`حاجز تحقق ما بعد تطبيق 2D مفقود: ${required}`);
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
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    writeDiagnostic(logPath, `${output}\n${result.error?.stack ?? ""}`);
    throw new Error(`فشل تحقق 2D بعد التطبيق؛ التشخيص المحمي: ${logPath}`);
  }
  return result.stdout;
}

function assertFunction(state, externallyCallable) {
  return state?.exists && state?.security_definer && state?.safe_search_path
    && !state?.anon_execute && state?.authenticated_execute === externallyCallable;
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا الفاحص لا يقبل معاملات");
  validatePostApplySource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.result !== "STAGING_INVENTORY_MISSING_JOURNAL_BASELINE_OK"
      || manifest.projectRef !== expectedProjectRef
      || manifest.files?.["baseline.json"]?.sha256 !== sha256(baselinePath)) {
    throw new Error("بصمة خط أساس Staging قبل 2D غير صالحة");
  }

  const reportDir = mkdtempSync("/tmp/accounting-staging-inventory-missing-journal-postapply-");
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  if (Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) {
    chownSync(reportDir, uid, gid);
  }
  const sqlPath = join(reportDir, "post-apply-verification.sql");
  const logPath = join(reportDir, "run.log");
  const reportPath = join(reportDir, "report.json");
  writeFileSync(sqlPath, verificationSql(), { mode: 0o600 });
  const verification = extractNamedPayload(runCli(sqlPath, logPath), "verification");
  const migrationState = verification?.migration_state ?? {};
  const gain = verification?.account_state?.["4201"];
  const loss = verification?.account_state?.["5201"];
  const functions = verification?.functions ?? {};
  const guards = verification?.executor_guards ?? {};
  const accountValid = gain?.count === 1 && gain?.type === "revenue" && gain?.parent_code === "4"
    && gain?.is_parent === false && gain?.is_active === true && gain?.is_system === true
    && loss?.count === 1 && loss?.type === "expense" && loss?.parent_code === "5"
    && loss?.is_parent === false && loss?.is_active === true && loss?.is_system === true;
  const valid = verification?.result === "STAGING_INVENTORY_MISSING_JOURNAL_POST_APPLY_OK"
    && verification?.database === "postgres"
    && verification?.server_version?.startsWith("17.")
    && migrationState.system_accounts && migrationState.planner_2da && migrationState.executor_2db
    && accountValid
    && verification?.guard_state?.function_exists
    && verification?.guard_state?.trigger_count === 1
    && assertFunction(functions.planner, true)
    && assertFunction(functions.planner_base, false)
    && assertFunction(functions.executor, true)
    && assertFunction(functions.rebuild, false)
    && guards.missing_journal_enabled && guards.rebuild_preserved && guards.mapping_validation
    && equalJson(verification.counts, baseline.counts)
    && equalJson(verification.signatures, baseline.signatures)
    && equalJson(stableDiagnostic(verification.diagnostic), stableDiagnostic(baseline.diagnostic));
  if (!valid) {
    writeDiagnostic(logPath, `${JSON.stringify({ baseline, verification }, null, 2)}\n`);
    throw new Error(`فشل تحقق حزمة 2D أو تغير خط الأساس؛ التشخيص المحمي: ${logPath}`);
  }

  writeFileSync(reportPath, `${JSON.stringify({
    result: verification.result,
    verifiedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    baselineArchive,
    migrations: versions,
    protectedAccounts: ["4201", "5201"],
    migrationsRecorded: true,
    functionsAndPrivilegesVerified: true,
    systemAccountDeleteGuardVerified: true,
    businessRepairAndDiagnosticBaselinePreserved: true,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجح التحقق الرسمي بعد تطبيق حزمة 2D على Staging");
  console.log("الإصدارات والحسابات المحمية والدوال والصلاحيات سليمة، وبيانات الأعمال والتشخيص مطابقة للنسخة");
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
