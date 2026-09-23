// Read-only backup and baseline for a controlled taxed-sale acceptance on Staging.
import { createHash } from "node:crypto";
import { chmodSync, chownSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRef = "dunzfxurefzlaamgghys";
const cli = "supabase@2.116.0";

export const fixture = Object.freeze({
  productId: "4d4d0000-0000-4000-8000-000000000401",
  invoiceId: "4d4d0000-0000-4000-8000-000000000402",
  itemId: "4d4d0000-0000-4000-8000-000000000403",
  saleMovementId: "4d4d0000-0000-4000-8000-000000000404",
  openingMovementId: "4d4d0000-0000-4000-8000-000000000405",
  productCode: "TST-TAX-SI-001",
  invoiceNumber: 990024,
});

function assertStaging() {
  if (readFileSync(join(root, "supabase/.temp/project-ref"), "utf8").trim() !== projectRef) {
    throw new Error("المشروع المرتبط ليس Staging المعتمد");
  }
}

function cliEnvironment() {
  if (process.getuid?.() === 0) {
    if (process.env.SUDO_USER !== "deploy") throw new Error("استخدم sudo من حساب deploy فقط");
    const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
    if (!token) throw new Error("جلسة Supabase غير موجودة");
    return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: token };
  }
  const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
  if (!token) throw new Error("جلسة Supabase غير موجودة");
  return { ...process.env, SUPABASE_ACCESS_TOKEN: token };
}

export function extract(output, key) {
  const visit = (value) => {
    if (!value || typeof value !== "object") return undefined;
    if (Object.hasOwn(value, key)) return value[key];
    for (const child of Object.values(value)) {
      const found = visit(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return visit(typeof output === "string" ? JSON.parse(output) : output);
}

export const baselineSql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'project_ref', '${projectRef}',
  'migration_state', jsonb_build_object(
    'planner', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921220000'),
    'executor', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921233000'),
    'ui_bridge', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260922070000'),
    'numbering', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923030000'),
    'tax_mapping', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923100000'),
    'output_tax', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923130000')
  ),
  'settings_count', (SELECT count(*) FROM public.company_settings),
  'tax_settings', (SELECT jsonb_build_object(
    'enable_tax', s.enable_tax, 'tax_rate', s.tax_rate,
    'purchase_code', p.code, 'purchase_system', p.is_system,
    'sales_code', v.code, 'sales_system', v.is_system,
    'sales_type', v.account_type, 'sales_active', v.is_active, 'sales_parent', v.is_parent
  ) FROM public.company_settings s
    LEFT JOIN public.accounts p ON p.id = s.purchase_tax_account_id
    LEFT JOIN public.accounts v ON v.id = s.sales_tax_account_id
    ORDER BY s.created_at LIMIT 1),
  'fixture_conflicts', jsonb_build_object(
    'products', (SELECT count(*) FROM public.products WHERE id = '${fixture.productId}'::uuid OR code = '${fixture.productCode}'),
    'invoices', (SELECT count(*) FROM public.sales_invoices WHERE id = '${fixture.invoiceId}'::uuid OR invoice_number = ${fixture.invoiceNumber}),
    'items', (SELECT count(*) FROM public.sales_invoice_items WHERE id = '${fixture.itemId}'::uuid),
    'movements', (SELECT count(*) FROM public.inventory_movements WHERE id IN ('${fixture.saleMovementId}'::uuid, '${fixture.openingMovementId}'::uuid)),
    'repairs', (SELECT count(*) FROM public.inventory_reconciliation_repair_items WHERE source_type = 'sales_invoice' AND source_id = '${fixture.invoiceId}'::uuid)
  ),
  'counts', jsonb_build_object(
    'accounts', (SELECT count(*) FROM public.accounts),
    'products', (SELECT count(*) FROM public.products),
    'inventory_movements', (SELECT count(*) FROM public.inventory_movements),
    'sales_invoices', (SELECT count(*) FROM public.sales_invoices),
    'sales_invoice_items', (SELECT count(*) FROM public.sales_invoice_items),
    'purchase_invoices', (SELECT count(*) FROM public.purchase_invoices),
    'journal_entries', (SELECT count(*) FROM public.journal_entries),
    'journal_entry_lines', (SELECT count(*) FROM public.journal_entry_lines),
    'repairs', (SELECT count(*) FROM public.inventory_reconciliation_repairs),
    'repair_items', (SELECT count(*) FROM public.inventory_reconciliation_repair_items),
    'repair_effects', (SELECT count(*) FROM public.inventory_reconciliation_repair_effects),
    'repair_events', (SELECT count(*) FROM public.inventory_reconciliation_repair_events)
  ),
  'signatures', jsonb_build_object(
    'accounts', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.accounts x),
    'settings', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.company_settings x),
    'products', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.products x),
    'inventory_movements', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_movements x),
    'sales_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.sales_invoices x),
    'sales_invoice_items', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.sales_invoice_items x),
    'purchase_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.purchase_invoices x),
    'journal_entries', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.journal_entries x),
    'journal_entry_lines', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.journal_entry_lines x),
    'repairs', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_reconciliation_repairs x),
    'repair_items', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_reconciliation_repair_items x),
    'repair_effects', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_reconciliation_repair_effects x),
    'repair_events', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_reconciliation_repair_events x)
  ),
  'diagnostic', public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)
) AS tax_sales_acceptance_baseline;
ROLLBACK;
`;

export function validateBaseline(state) {
  const failures = [];
  if (state?.database !== "postgres" || state?.project_ref !== projectRef || !state?.server_version?.startsWith("17.")) failures.push("database_identity");
  if (Object.values(state?.migration_state ?? {}).length !== 6 || Object.values(state.migration_state).some((value) => value !== true)) failures.push("migrations");
  if (Number(state?.settings_count) !== 1) failures.push("settings_count");
  const tax = state?.tax_settings;
  if (!tax || tax.enable_tax !== true || Number(tax.tax_rate) !== 14 || tax.purchase_code !== "1105" || tax.purchase_system !== true
      || tax.sales_code !== "2104" || tax.sales_system !== true || tax.sales_type !== "liability" || tax.sales_active !== true || tax.sales_parent !== false) failures.push("tax_settings");
  if (Object.keys(state?.fixture_conflicts ?? {}).length !== 5 || Object.values(state.fixture_conflicts).some((value) => Number(value) !== 0)) failures.push("fixture_conflicts");
  if (failures.length) throw new Error(`خط أساس قبول البيع الضريبي غير آمن: ${failures.join(",")}`);
  return state;
}

function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function runCli(args, logPath) {
  assertStaging();
  const result = spawnSync("npx", ["-y", cli, ...args], {
    cwd: root, env: cliEnvironment(), encoding: "utf8", timeout: 300000, maxBuffer: 96 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\n`, { mode: 0o600 });
    throw new Error(`فشل نسخ Staging للقراءة فقط؛ التشخيص: ${logPath}`);
  }
  return result.stdout;
}

function returnToCaller(path) {
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  if (Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) chownSync(path, uid, gid);
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStaging();
  process.umask(0o077);
  const dir = mkdtempSync("/tmp/staging-inventory-tax-sales-acceptance-before-");
  chmodSync(dir, 0o700);
  const schema = join(dir, "public-schema.sql");
  const data = join(dir, "public-data.sql");
  const query = join(dir, "baseline-query.sql");
  const baselinePath = join(dir, "baseline.json");
  const manifestPath = join(dir, "manifest.json");
  const log = join(dir, "run.log");
  writeFileSync(query, baselineSql, { mode: 0o600 });
  try {
    runCli(["db", "dump", "--linked", "--schema", "public", "--file", schema], log);
    runCli(["db", "dump", "--linked", "--schema", "public", "--data-only", "--use-copy", "--file", data], log);
    chmodSync(schema, 0o600); chmodSync(data, 0o600);
    if (statSync(schema).size < 10_000 || statSync(data).size < 10_000) throw new Error("نسخة Staging غير مكتملة");
    const state = validateBaseline(extract(runCli(["db", "query", "--linked", "--output-format", "json", "--file", query], log), "tax_sales_acceptance_baseline"));
    writeFileSync(baselinePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    const files = [schema, data, query, baselinePath];
    writeFileSync(manifestPath, `${JSON.stringify({ result: "STAGING_TAX_SALES_BASELINE_OK", projectRef, createdAt: new Date().toISOString(), readOnly: true, fixture, files: Object.fromEntries(files.map((path) => [path.split("/").at(-1), { bytes: statSync(path).size, sha256: sha256(path) }])) }, null, 2)}\n`, { mode: 0o600 });
    const sums = join(dir, "SHA256SUMS");
    writeFileSync(sums, `${[...files, manifestPath].map((path) => `${sha256(path)}  ${path.split("/").at(-1)}`).join("\n")}\n`, { mode: 0o600 });
    for (const path of [dir, ...files, manifestPath, sums]) returnToCaller(path);
    console.log("تم إنشاء نسخة Staging وخط أساس البيع الضريبي للقراءة فقط");
    console.log(`SOURCE_DIR=${dir}`);
    console.log(`COUNTS=${JSON.stringify(state.counts)}`);
    console.log(`TAX_SETTINGS=${JSON.stringify(state.tax_settings)}`);
  } catch (error) {
    for (const path of [dir, query, log]) { try { returnToCaller(path); } catch { /* best effort */ } }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
