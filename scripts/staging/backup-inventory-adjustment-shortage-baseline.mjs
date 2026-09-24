// Read-only Staging backup before the controlled inventory-shortage adjustment acceptance.
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture as saleFixture } from "./backup-inventory-tax-sales-acceptance-baseline.mjs";
import { fixture as returnFixture } from "./backup-inventory-tax-sales-return-acceptance-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRef = "dunzfxurefzlaamgghys";
const cli = "supabase@2.116.0";

export const fixture = Object.freeze({
  adjustmentId: "8d8d0000-0000-4000-8000-000000000801",
  itemId: "8d8d0000-0000-4000-8000-000000000802",
  movementId: "8d8d0000-0000-4000-8000-000000000803",
  adjustmentNumber: 990028,
  productId: saleFixture.productId,
  saleInvoiceId: saleFixture.invoiceId,
  saleReturnId: returnFixture.returnId,
});

const tables = ["accounts", "company_settings", "products", "inventory_movements", "inventory_adjustments",
  "inventory_adjustment_items", "sales_invoices", "sales_returns", "purchase_invoices", "purchase_returns",
  "journal_entries", "journal_entry_lines", "inventory_reconciliation_repairs",
  "inventory_reconciliation_repair_items", "inventory_reconciliation_repair_effects",
  "inventory_reconciliation_repair_events"];
const aliases = { company_settings: "settings", inventory_reconciliation_repairs: "repairs",
  inventory_reconciliation_repair_items: "repair_items", inventory_reconciliation_repair_effects: "repair_effects",
  inventory_reconciliation_repair_events: "repair_events" };

export const baselineSql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT jsonb_build_object(
  'database', current_database(), 'server_version', current_setting('server_version'), 'project_ref', '${projectRef}',
  'migration_state', jsonb_build_object(
    'system_accounts', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921213000'),
    'planner', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921220000'),
    'executor', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921233000'),
    'ui_bridge', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260922070000'),
    'numbering', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923030000')
  ),
  'account_map', (SELECT jsonb_object_agg(a.code, jsonb_build_object('id', a.id, 'active', a.is_active,
    'parent', a.is_parent, 'system', a.is_system, 'type', a.account_type, 'parent_code', p.code))
    FROM public.accounts a LEFT JOIN public.accounts p ON p.id = a.parent_id WHERE a.code IN ('1104', '5201')),
  'source_product', (SELECT jsonb_build_object('id', p.id, 'code', p.code,
    'quantity', p.quantity_on_hand, 'purchase_price', p.purchase_price)
    FROM public.products p WHERE p.id = '${fixture.productId}'::uuid),
  'stock_movement', (SELECT jsonb_build_object('count', count(*),
    'signed_quantity', COALESCE(sum(public.inventory_signed_quantity(m.movement_type::text, m.quantity)), 0),
    'signed_value', COALESCE(sum(CASE WHEN m.movement_type::text = 'adjustment'
      THEN sign(m.quantity) * abs(m.total_cost)
      WHEN m.movement_type::text IN ('sale', 'purchase_return') THEN -abs(m.total_cost)
      ELSE abs(m.total_cost) END), 0))
    FROM public.inventory_movements m WHERE m.product_id = '${fixture.productId}'::uuid),
  'prior_sale', (SELECT jsonb_build_object('id', s.id, 'status', s.status, 'journal_status', j.status)
    FROM public.sales_invoices s LEFT JOIN public.journal_entries j ON j.id = s.journal_entry_id
    WHERE s.id = '${fixture.saleInvoiceId}'::uuid),
  'prior_return', (SELECT jsonb_build_object('id', s.id, 'status', s.status, 'journal_status', j.status)
    FROM public.sales_returns s LEFT JOIN public.journal_entries j ON j.id = s.journal_entry_id
    WHERE s.id = '${fixture.saleReturnId}'::uuid),
  'fixture_conflicts', jsonb_build_object(
    'adjustments', (SELECT count(*) FROM public.inventory_adjustments WHERE id = '${fixture.adjustmentId}'::uuid OR adjustment_number = ${fixture.adjustmentNumber}),
    'items', (SELECT count(*) FROM public.inventory_adjustment_items WHERE id = '${fixture.itemId}'::uuid),
    'movements', (SELECT count(*) FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid),
    'repairs', (SELECT count(*) FROM public.inventory_reconciliation_repair_items WHERE source_type = 'adjustment' AND source_id = '${fixture.adjustmentId}'::uuid)
  ),
  'counts', jsonb_build_object(
${tables.map((table) => `    '${aliases[table] ?? table}', (SELECT count(*) FROM public.${table})`).join(",\n")}
  ),
  'signatures', jsonb_build_object(
${tables.map((table) => `    '${aliases[table] ?? table}', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.${table} x)`).join(",\n")}
  ),
  'diagnostic', public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)
) AS adjustment_shortage_baseline;
ROLLBACK;
`;

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

export function validateBaseline(value) {
  const failures = [];
  if (value?.database !== "postgres" || value?.project_ref !== projectRef || !value?.server_version?.startsWith("17.")) failures.push("database_identity");
  if (Object.keys(value?.migration_state ?? {}).length !== 5 || Object.values(value.migration_state).some((present) => present !== true)) failures.push("migrations");
  const stock = value?.account_map?.["1104"];
  const loss = value?.account_map?.["5201"];
  if (!stock || stock.active !== true || stock.parent !== false || stock.system !== true || stock.type !== "asset"
      || !loss || loss.active !== true || loss.parent !== false || loss.system !== true
      || loss.type !== "expense" || loss.parent_code !== "5") failures.push("account_map");
  if (value?.source_product?.id !== fixture.productId || value?.source_product?.code !== "TST-TAX-SI-001"
      || Number(value?.source_product?.quantity) !== 10 || Number(value?.source_product?.purchase_price) !== 40
      || Number(value?.stock_movement?.signed_quantity) !== 10 || Number(value?.stock_movement?.signed_value) !== 400) failures.push("source_inventory");
  if (value?.prior_sale?.id !== fixture.saleInvoiceId || value?.prior_sale?.status !== "posted"
      || value?.prior_sale?.journal_status !== "posted"
      || value?.prior_return?.id !== fixture.saleReturnId || value?.prior_return?.status !== "posted"
      || value?.prior_return?.journal_status !== "posted") failures.push("prior_documents");
  if (Object.keys(value?.fixture_conflicts ?? {}).length !== 4
      || Object.values(value.fixture_conflicts).some((count) => Number(count) !== 0)) failures.push("fixture_conflicts");
  if (failures.length) throw new Error(`خط أساس تسوية العجز غير آمن: ${failures.join(",")}`);
  return value;
}

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
    throw new Error(`فشل نسخ Staging قبل تسوية العجز؛ التشخيص: ${logPath}`);
  }
  return result.stdout;
}

function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStaging();
  process.umask(0o077);
  const dir = mkdtempSync("/tmp/staging-inventory-adjustment-shortage-before-");
  chmodSync(dir, 0o700);
  const schema = join(dir, "public-schema.sql");
  const data = join(dir, "public-data.sql");
  const query = join(dir, "baseline-query.sql");
  const baselinePath = join(dir, "baseline.json");
  const manifestPath = join(dir, "manifest.json");
  const log = join(dir, "run.log");
  writeFileSync(query, baselineSql, { mode: 0o600 });
  runCli(["db", "dump", "--linked", "--schema", "public", "--file", schema], log);
  runCli(["db", "dump", "--linked", "--schema", "public", "--data-only", "--use-copy", "--file", data], log);
  chmodSync(schema, 0o600); chmodSync(data, 0o600);
  if (statSync(schema).size < 10_000 || statSync(data).size < 10_000) throw new Error("نسخة Staging غير مكتملة");
  const value = validateBaseline(extract(runCli(["db", "query", "--linked", "--output-format", "json", "--file", query], log), "adjustment_shortage_baseline"));
  writeFileSync(baselinePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  const files = [schema, data, query, baselinePath];
  writeFileSync(manifestPath, `${JSON.stringify({ result: "STAGING_ADJUSTMENT_SHORTAGE_BASELINE_OK", projectRef,
    createdAt: new Date().toISOString(), readOnly: true, fixture,
    files: Object.fromEntries(files.map((path) => [path.split("/").at(-1), { bytes: statSync(path).size, sha256: sha256(path) }])) }, null, 2)}\n`, { mode: 0o600 });
  const sums = join(dir, "SHA256SUMS");
  writeFileSync(sums, `${[...files, manifestPath].map((path) => `${sha256(path)}  ${path.split("/").at(-1)}`).join("\n")}\n`, { mode: 0o600 });
  console.log("تم إنشاء نسخة Staging وخط أساس تسوية العجز للقراءة فقط");
  console.log(`SOURCE_DIR=${dir}`);
  console.log(`COUNTS=${JSON.stringify(value.counts)}`);
  console.log(`PRODUCT=${JSON.stringify(value.source_product)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
