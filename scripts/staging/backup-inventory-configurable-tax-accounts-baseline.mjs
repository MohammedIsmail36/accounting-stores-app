// Read-only Staging backup and baseline before configurable 2D tax mappings.
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  chownSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const cli = "supabase@2.116.0";
const configurableTaxVersion = "20260923100000";

function assertStagingLink() {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }
}

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") {
      throw new Error("شغّل النسخة بواسطة sudo من حساب deploy فقط");
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
  appendFileSync(path, `\n=== diagnostic ===\n${message}\n`, { mode: 0o600 });
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  if (Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) {
    chownSync(path, uid, gid);
  }
}

function runCli(args, logPath) {
  assertStagingLink();
  const result = spawnSync("npx", ["-y", cli, ...args], {
    cwd: root,
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 96 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    appendFileSync(logPath,
      `\n=== supabase ${args.join(" ")} ===\n${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\n`,
      { mode: 0o600 });
    throw new Error(`فشل إنشاء نسخة Staging قبل حسابات الضريبة القابلة للتهيئة؛ التشخيص: ${logPath}`);
  }
  return result.stdout;
}

export function extractNamedPayload(output, name) {
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

export const baselineSql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'project_ref', '${expectedProjectRef}',
  'migration_state', jsonb_build_object(
    'system_accounts', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921213000'),
    'planner', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921220000'),
    'executor', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921233000'),
    'ui_bridge', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260922070000'),
    'journal_numbering', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923030000'),
    'configurable_tax', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${configurableTaxVersion}')
  ),
  'function_state', jsonb_build_object(
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
  'trigger_state', jsonb_build_object(
    'settings_validator', EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.company_settings'::regclass
        AND tgname = 'trg_validate_company_tax_account_mapping' AND NOT tgisinternal),
    'account_guard', EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.accounts'::regclass
        AND tgname = 'trg_guard_configured_tax_account_shape' AND NOT tgisinternal)
  ),
  'tax_settings', (
    SELECT jsonb_build_object(
      'settings_id', s.id,
      'enable_tax', s.enable_tax,
      'tax_rate', s.tax_rate,
      'purchase_account', CASE WHEN s.purchase_tax_account_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', p.id, 'code', p.code, 'type', p.account_type,
        'active', p.is_active, 'parent', p.is_parent) END,
      'sales_account', CASE WHEN s.sales_tax_account_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v.id, 'code', v.code, 'type', v.account_type,
        'active', v.is_active, 'parent', v.is_parent) END
    )
    FROM public.company_settings s
    LEFT JOIN public.accounts p ON p.id = s.purchase_tax_account_id
    LEFT JOIN public.accounts v ON v.id = s.sales_tax_account_id
    ORDER BY s.created_at LIMIT 1
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
    'accounts', (SELECT md5(COALESCE(string_agg(to_jsonb(a)::text, '|' ORDER BY a.id), '')) FROM public.accounts a),
    'company_settings', (SELECT md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), '')) FROM public.company_settings s),
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
) AS baseline;
ROLLBACK;
`;

export function validateBaseline(baseline) {
  const failures = [];
  const migrations = baseline?.migration_state ?? {};
  const functions = baseline?.function_state ?? {};
  const triggers = baseline?.trigger_state ?? {};
  const tax = baseline?.tax_settings;
  const purchase = tax?.purchase_account;
  const sales = tax?.sales_account;

  if (!baseline) failures.push("baseline_missing");
  if (baseline?.database !== "postgres") failures.push("database_identity");
  if (baseline?.project_ref !== expectedProjectRef) failures.push("project_identity");
  if (!baseline?.server_version?.startsWith("17.")) failures.push("server_version");
  for (const key of ["system_accounts", "planner", "executor", "ui_bridge", "journal_numbering"]) {
    if (!migrations[key]) failures.push(`migration_missing_${key}`);
  }
  if (migrations.configurable_tax) failures.push("migration_already_present");
  if (!functions.public_planner || !functions.base_planner
      || !functions.base_contains_1105 || !functions.base_contains_2102) {
    failures.push("planner_baseline");
  }
  if (functions.fixed_tax_legacy || functions.settings_validator || functions.account_guard
      || triggers.settings_validator || triggers.account_guard) {
    failures.push("configurable_tax_components_already_present");
  }
  if (!tax) failures.push("tax_settings_missing");
  if (tax?.enable_tax && (!purchase || !sales)) failures.push("enabled_tax_accounts_missing");
  if (purchase && (purchase.type !== "asset" || purchase.active !== true || purchase.parent !== false)) {
    failures.push("purchase_tax_account_invalid");
  }
  if (sales && (sales.type !== "liability" || sales.active !== true || sales.parent !== false)) {
    failures.push("sales_tax_account_invalid");
  }
  if (failures.length > 0) {
    throw new Error(`خط أساس Staging قبل حسابات الضريبة غير آمن: ${failures.join(",")}`);
  }
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStagingLink();
  process.umask(0o077);
  const outputDir = mkdtempSync("/tmp/staging-inventory-configurable-tax-before-");
  chmodSync(outputDir, 0o700);
  const schemaPath = join(outputDir, "public-schema.sql");
  const dataPath = join(outputDir, "public-data.sql");
  const queryPath = join(outputDir, "baseline-query.sql");
  const baselinePath = join(outputDir, "baseline.json");
  const manifestPath = join(outputDir, "manifest.json");
  const logPath = join(outputDir, "run.log");
  writeFileSync(queryPath, baselineSql, { mode: 0o600 });

  try {
    runCli(["db", "dump", "--linked", "--schema", "public", "--file", schemaPath], logPath);
    runCli(["db", "dump", "--linked", "--schema", "public", "--data-only", "--use-copy", "--file", dataPath], logPath);
    chmodSync(schemaPath, 0o600);
    chmodSync(dataPath, 0o600);
    if (statSync(schemaPath).size < 10_000 || statSync(dataPath).size < 10_000) {
      throw new Error("نسخة Staging غير مكتملة");
    }
    const queryOutput = runCli(
      ["db", "query", "--linked", "--output-format", "json", "--file", queryPath], logPath);
    writeFileSync(join(outputDir, "query-output.json"), queryOutput, { mode: 0o600 });
    const baseline = extractNamedPayload(queryOutput, "baseline");
    writeFileSync(join(outputDir, "baseline-candidate.json"),
      `${JSON.stringify(baseline ?? null, null, 2)}\n`, { mode: 0o600 });
    validateBaseline(baseline);
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 });

    const files = [schemaPath, dataPath, queryPath, baselinePath];
    const manifest = {
      result: "STAGING_INVENTORY_CONFIGURABLE_TAX_BASELINE_OK",
      projectRef: expectedProjectRef,
      createdAt: new Date().toISOString(),
      readOnly: true,
      configurableTaxMigrationAbsent: true,
      taxMappingSemanticallyValid: true,
      productionModified: false,
      files: Object.fromEntries(files.map((path) => [path.split("/").at(-1), {
        bytes: statSync(path).size,
        sha256: sha256(path),
      }])),
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(join(outputDir, "SHA256SUMS"), `${[...files, manifestPath]
      .map((path) => `${sha256(path)}  ${path.split("/").at(-1)}`).join("\n")}\n`, { mode: 0o600 });

    console.log("تم إنشاء نسخة Staging وخط أساس حسابات الضريبة دون كتابة على القاعدة");
    console.log(`SOURCE_DIR=${outputDir}`);
    console.log(`COUNTS=${JSON.stringify(baseline.counts)}`);
    console.log(`TAX_SETTINGS=${JSON.stringify(baseline.tax_settings)}`);
    console.log(`DIAGNOSTIC_STATUS=${baseline.diagnostic?.status}`);
  } catch (error) {
    writeDiagnostic(logPath, error.message);
    throw new Error(`${error.message}؛ الملفات التشخيصية: ${outputDir}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
