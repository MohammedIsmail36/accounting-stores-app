// Read-only Staging backup before a controlled taxed sales-return acceptance.
import { createHash } from "node:crypto";
import { chmodSync, chownSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture as saleFixture } from "./backup-inventory-tax-sales-acceptance-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRef = "dunzfxurefzlaamgghys";
const cli = "supabase@2.116.0";

export const fixture = Object.freeze({
  returnId: "5d5d0000-0000-4000-8000-000000000501",
  itemId: "5d5d0000-0000-4000-8000-000000000502",
  movementId: "5d5d0000-0000-4000-8000-000000000503",
  returnNumber: 990025,
  sourceInvoiceId: saleFixture.invoiceId,
  productId: saleFixture.productId,
});

function assertStaging() {
  if (readFileSync(join(root, "supabase/.temp/project-ref"), "utf8").trim() !== projectRef) {
    throw new Error("المشروع المرتبط ليس Staging المعتمد");
  }
}

function cliEnvironment() {
  if (process.getuid?.() === 0 && process.env.SUDO_USER !== "deploy") throw new Error("استخدم sudo من حساب deploy فقط");
  const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
  if (!token) throw new Error("جلسة Supabase غير موجودة");
  return { ...process.env, ...(process.getuid?.() === 0 ? { HOME: "/home/deploy" } : {}), SUPABASE_ACCESS_TOKEN: token };
}

function runCli(args, logPath) {
  assertStaging();
  const result = spawnSync("npx", ["-y", cli, ...args], {
    cwd: root, env: cliEnvironment(), encoding: "utf8", timeout: 300000, maxBuffer: 96 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\n`, { mode: 0o600 });
    throw new Error(`فشل نسخ Staging قبل مرتجع البيع؛ التشخيص: ${logPath}`);
  }
  return result.stdout;
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
  'database', current_database(), 'server_version', current_setting('server_version'), 'project_ref', '${projectRef}',
  'migration_state', jsonb_build_object(
    'planner', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921220000'),
    'executor', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921233000'),
    'ui_bridge', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260922070000'),
    'numbering', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923030000'),
    'tax_mapping', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923100000'),
    'output_tax', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923130000')
  ),
  'settings_count', (SELECT count(*) FROM public.company_settings),
  'tax_settings', (SELECT jsonb_build_object('enable_tax', s.enable_tax, 'tax_rate', s.tax_rate,
    'purchase_code', p.code, 'sales_code', v.code, 'sales_system', v.is_system,
    'sales_active', v.is_active, 'sales_parent', v.is_parent)
    FROM public.company_settings s
    LEFT JOIN public.accounts p ON p.id = s.purchase_tax_account_id
    LEFT JOIN public.accounts v ON v.id = s.sales_tax_account_id ORDER BY s.created_at LIMIT 1),
  'source_invoice', (SELECT jsonb_build_object('id', i.id, 'invoice_number', i.invoice_number,
    'status', i.status, 'subtotal', i.subtotal, 'tax', i.tax, 'total', i.total,
    'journal_entry_id', i.journal_entry_id, 'journal_status', j.status)
    FROM public.sales_invoices i LEFT JOIN public.journal_entries j ON j.id = i.journal_entry_id
    WHERE i.id = '${fixture.sourceInvoiceId}'::uuid),
  'source_product', (SELECT jsonb_build_object('id', p.id, 'code', p.code,
    'quantity', p.quantity_on_hand, 'purchase_price', p.purchase_price)
    FROM public.products p WHERE p.id = '${fixture.productId}'::uuid),
  'fixture_conflicts', jsonb_build_object(
    'returns', (SELECT count(*) FROM public.sales_returns WHERE id = '${fixture.returnId}'::uuid OR return_number = ${fixture.returnNumber}),
    'items', (SELECT count(*) FROM public.sales_return_items WHERE id = '${fixture.itemId}'::uuid),
    'movements', (SELECT count(*) FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid),
    'repairs', (SELECT count(*) FROM public.inventory_reconciliation_repair_items WHERE source_type = 'sales_return' AND source_id = '${fixture.returnId}'::uuid)
  ),
  'counts', jsonb_build_object(
    'accounts', (SELECT count(*) FROM public.accounts),
    'products', (SELECT count(*) FROM public.products),
    'inventory_movements', (SELECT count(*) FROM public.inventory_movements),
    'sales_invoices', (SELECT count(*) FROM public.sales_invoices),
    'sales_returns', (SELECT count(*) FROM public.sales_returns),
    'sales_return_items', (SELECT count(*) FROM public.sales_return_items),
    'purchase_invoices', (SELECT count(*) FROM public.purchase_invoices),
    'purchase_returns', (SELECT count(*) FROM public.purchase_returns),
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
    'sales_returns', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.sales_returns x),
    'sales_return_items', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.sales_return_items x),
    'purchase_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.purchase_invoices x),
    'purchase_returns', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.purchase_returns x),
    'journal_entries', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.journal_entries x),
    'journal_entry_lines', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.journal_entry_lines x),
    'repairs', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_reconciliation_repairs x),
    'repair_items', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_reconciliation_repair_items x),
    'repair_effects', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_reconciliation_repair_effects x),
    'repair_events', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_reconciliation_repair_events x)
  ),
  'diagnostic', public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)
) AS sales_return_acceptance_baseline;
ROLLBACK;
`;

export function validateBaseline(value) {
  const failures = [];
  if (value?.database !== "postgres" || value?.project_ref !== projectRef || !value?.server_version?.startsWith("17.")) failures.push("database_identity");
  if (Object.keys(value?.migration_state ?? {}).length !== 6 || Object.values(value.migration_state).some((present) => present !== true)) failures.push("migrations");
  if (Number(value?.settings_count) !== 1 || value?.tax_settings?.enable_tax !== true || Number(value?.tax_settings?.tax_rate) !== 14
      || value?.tax_settings?.purchase_code !== "1105" || value?.tax_settings?.sales_code !== "2104"
      || value?.tax_settings?.sales_system !== true || value?.tax_settings?.sales_active !== true
      || value?.tax_settings?.sales_parent !== false) failures.push("tax_settings");
  if (value?.source_invoice?.id !== fixture.sourceInvoiceId || value?.source_invoice?.invoice_number !== 990024
      || value?.source_invoice?.status !== "posted" || value?.source_invoice?.journal_status !== "posted"
      || !value?.source_invoice?.journal_entry_id || Number(value?.source_invoice?.tax) !== 14
      || Number(value?.source_invoice?.total) !== 114) failures.push("source_invoice");
  if (value?.source_product?.id !== fixture.productId || value?.source_product?.code !== "TST-TAX-SI-001"
      || Number(value?.source_product?.quantity) !== 8 || Number(value?.source_product?.purchase_price) !== 40) failures.push("source_product");
  if (Object.keys(value?.fixture_conflicts ?? {}).length !== 4 || Object.values(value.fixture_conflicts).some((count) => Number(count) !== 0)) failures.push("fixture_conflicts");
  if (failures.length) throw new Error(`خط أساس مرتجع البيع غير آمن: ${failures.join(",")}`);
  return value;
}

function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function returnToCaller(path) {
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  if (Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) chownSync(path, uid, gid);
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStaging();
  process.umask(0o077);
  const dir = mkdtempSync("/tmp/staging-inventory-tax-sales-return-before-");
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
    const value = validateBaseline(extract(runCli(["db", "query", "--linked", "--output-format", "json", "--file", query], log), "sales_return_acceptance_baseline"));
    writeFileSync(baselinePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    const files = [schema, data, query, baselinePath];
    writeFileSync(manifestPath, `${JSON.stringify({ result: "STAGING_TAX_SALES_RETURN_BASELINE_OK", projectRef,
      createdAt: new Date().toISOString(), readOnly: true, fixture,
      files: Object.fromEntries(files.map((path) => [path.split("/").at(-1), { bytes: statSync(path).size, sha256: sha256(path) }])) }, null, 2)}\n`, { mode: 0o600 });
    const sums = join(dir, "SHA256SUMS");
    writeFileSync(sums, `${[...files, manifestPath].map((path) => `${sha256(path)}  ${path.split("/").at(-1)}`).join("\n")}\n`, { mode: 0o600 });
    for (const path of [dir, ...files, manifestPath, sums]) returnToCaller(path);
    console.log("تم إنشاء نسخة Staging وخط أساس مرتجع البيع الضريبي للقراءة فقط");
    console.log(`SOURCE_DIR=${dir}`);
    console.log(`COUNTS=${JSON.stringify(value.counts)}`);
    console.log(`TAX_SETTINGS=${JSON.stringify(value.tax_settings)}`);
  } catch (error) {
    for (const path of [dir, query, log]) { try { returnToCaller(path); } catch { /* best effort */ } }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
