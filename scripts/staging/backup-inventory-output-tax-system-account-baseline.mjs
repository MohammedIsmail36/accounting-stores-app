// Read-only Staging backup and baseline before the protected output-tax account migration.
import { createHash } from "node:crypto";
import {
  chmodSync,
  chownSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const cli = "supabase@2.116.0";

function assertStagingLink() {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض النسخ: المشروع المرتبط ليس Staging المعتمد");
  }
}

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") throw new Error("شغّل النسخ بواسطة sudo من حساب deploy فقط");
    const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
    if (!token) throw new Error("جلسة Supabase للمستخدم deploy غير موجودة");
    return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: token };
  }
  return process.env;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function returnOutputToCaller(path) {
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  if (Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) chownSync(path, uid, gid);
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
    writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\n`, { mode: 0o600 });
    throw new Error(`فشل إنشاء نسخة Staging قبل حساب 2104؛ التشخيص: ${logPath}`);
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
    'configurable_tax', EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923100000'
    ),
    'output_tax_account', EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923130000'
    )
  ),
  'tax_accounts', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', a.id, 'code', a.code, 'name', a.name, 'type', a.account_type,
      'active', a.is_active, 'parent', a.is_parent, 'system', a.is_system,
      'parent_code', p.code, 'journal_lines', (
        SELECT count(*) FROM public.journal_entry_lines l WHERE l.account_id = a.id
      )
    ) ORDER BY a.code)
    FROM public.accounts a
    LEFT JOIN public.accounts p ON p.id = a.parent_id
    WHERE a.code IN ('1105', '2102', '2103', '2104')
  ), '[]'::jsonb),
  'settings_count', (SELECT count(*) FROM public.company_settings),
  'tax_settings', (
    SELECT jsonb_build_object(
      'id', s.id,
      'enable_tax', s.enable_tax,
      'tax_rate', s.tax_rate,
      'purchase_tax_account_id', s.purchase_tax_account_id,
      'sales_tax_account_id', s.sales_tax_account_id
    )
    FROM public.company_settings s ORDER BY s.created_at LIMIT 1
  ),
  'counts', jsonb_build_object(
    'accounts', (SELECT count(*) FROM public.accounts),
    'products', (SELECT count(*) FROM public.products),
    'inventory_movements', (SELECT count(*) FROM public.inventory_movements),
    'sales_invoices', (SELECT count(*) FROM public.sales_invoices),
    'purchase_invoices', (SELECT count(*) FROM public.purchase_invoices),
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
    'purchase_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.purchase_invoices p),
    'journal_entries', (SELECT md5(COALESCE(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id), '')) FROM public.journal_entries j),
    'journal_entry_lines', (SELECT md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), '')) FROM public.journal_entry_lines l),
    'repairs', (SELECT md5(COALESCE(string_agg(to_jsonb(r)::text, '|' ORDER BY r.id), '')) FROM public.inventory_reconciliation_repairs r),
    'repair_items', (SELECT md5(COALESCE(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id), '')) FROM public.inventory_reconciliation_repair_items i),
    'repair_effects', (SELECT md5(COALESCE(string_agg(to_jsonb(e)::text, '|' ORDER BY e.id), '')) FROM public.inventory_reconciliation_repair_effects e),
    'repair_events', (SELECT md5(COALESCE(string_agg(to_jsonb(e)::text, '|' ORDER BY e.id), '')) FROM public.inventory_reconciliation_repair_events e)
  ),
  'diagnostic', public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)
) AS output_tax_baseline;
ROLLBACK;
`;

export function validateBaseline(baseline) {
  const failures = [];
  const accounts = new Map((baseline?.tax_accounts ?? []).map((account) => [account.code, account]));
  const input = accounts.get("1105");
  const shortLoan = accounts.get("2102");
  const longLoan = accounts.get("2103");
  const settings = baseline?.tax_settings;

  if (!baseline) failures.push("baseline_missing");
  if (baseline?.database !== "postgres") failures.push("database_identity");
  if (baseline?.project_ref !== expectedProjectRef) failures.push("project_identity");
  if (!baseline?.server_version?.startsWith("17.")) failures.push("server_version");
  if (!baseline?.migration_state?.configurable_tax) failures.push("configurable_tax_migration_missing");
  if (baseline?.migration_state?.output_tax_account) failures.push("output_tax_migration_already_present");
  if (Number(baseline?.settings_count) !== 1 || !settings) failures.push("settings_identity");
  if (accounts.has("2104")) failures.push("output_tax_account_already_present");
  if (!input || input.name !== "ضريبة القيمة المضافة للمدخلات" || input.type !== "asset"
      || !input.active || input.parent || !input.system || input.parent_code !== "11") {
    failures.push("input_tax_account_invalid");
  }
  if (!shortLoan || shortLoan.name !== "قروض قصيرة الأجل" || shortLoan.type !== "liability") {
    failures.push("short_loan_identity");
  }
  if (!longLoan || longLoan.name !== "قروض طويلة الأجل" || longLoan.type !== "liability") {
    failures.push("long_loan_identity");
  }
  if (settings?.enable_tax !== false || Number(settings?.tax_rate) !== 0
      || settings?.purchase_tax_account_id !== null || settings?.sales_tax_account_id !== null) {
    failures.push("unexpected_tax_settings_state");
  }
  if (failures.length > 0) throw new Error(`خط أساس Staging قبل 2104 غير آمن: ${failures.join(",")}`);
  return baseline;
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStagingLink();
  process.umask(0o077);
  const outputDir = mkdtempSync("/tmp/staging-inventory-output-tax-before-");
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
    if (statSync(schemaPath).size < 10_000 || statSync(dataPath).size < 10_000) throw new Error("نسخة Staging غير مكتملة");

    const output = runCli(["db", "query", "--linked", "--output-format", "json", "--file", queryPath], logPath);
    const baseline = validateBaseline(extractNamedPayload(output, "output_tax_baseline"));
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 });

    const files = [schemaPath, dataPath, queryPath, baselinePath];
    const manifest = {
      result: "STAGING_INVENTORY_OUTPUT_TAX_BASELINE_OK",
      projectRef: expectedProjectRef,
      createdAt: new Date().toISOString(),
      readOnly: true,
      outputTaxMigrationAbsent: true,
      productionModified: false,
      files: Object.fromEntries(files.map((path) => [path.split("/").at(-1), {
        bytes: statSync(path).size,
        sha256: sha256(path),
      }])),
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(join(outputDir, "SHA256SUMS"), `${[...files, manifestPath]
      .map((path) => `${sha256(path)}  ${path.split("/").at(-1)}`).join("\n")}\n`, { mode: 0o600 });

    for (const path of [outputDir, schemaPath, dataPath, queryPath, baselinePath, manifestPath, logPath, join(outputDir, "SHA256SUMS")]) {
      if (path === logPath && !statSync(logPath, { throwIfNoEntry: false })) continue;
      returnOutputToCaller(path);
    }
    console.log("تم إنشاء نسخة Staging وخط أساس ما قبل حساب 2104 دون كتابة على القاعدة");
    console.log(`SOURCE_DIR=${outputDir}`);
    console.log(`COUNTS=${JSON.stringify(baseline.counts)}`);
    console.log(`TAX_SETTINGS=${JSON.stringify(baseline.tax_settings)}`);
    console.log(`DIAGNOSTIC_STATUS=${baseline.diagnostic?.status ?? "unknown"}`);
  } catch (error) {
    for (const path of [outputDir, queryPath, logPath]) {
      try { returnOutputToCaller(path); } catch { /* best effort */ }
    }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
