// Read-only backup and preflight before testing a stale inventory repair on Staging.
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRefPath = join(root, "supabase/.temp/project-ref");
const expectedProjectRef = "dunzfxurefzlaamgghys";
const productId = "2e364454-c894-48f4-bb47-1389ee723336";
const cli = "supabase@2.116.0";

function assertStagingLink() {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function runCli(args, logPath) {
  assertStagingLink();
  const result = spawnSync("npx", ["-y", cli, ...args], {
    cwd: root, encoding: "utf8", timeout: 240000, maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\n`, { mode: 0o600 });
    throw new Error(`فشل فحص Staging القرائي؛ التشخيص المحمي: ${logPath}`);
  }
  return result.stdout;
}

const baselineSql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
WITH target AS (
  SELECT * FROM public.products WHERE id = '${productId}'::uuid AND code = 'PRD-002'
), target_diagnostic AS (
  SELECT value AS row_data
  FROM jsonb_array_elements(public.get_inventory_reconciliation_diagnostic(
    'products', false, 'PRD-002', 500, 0, NULL
  )->'rows')
  WHERE value->>'product_id' = '${productId}'
)
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'project_ref', '${expectedProjectRef}',
  'executor_recorded', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260914190000'
  ),
  'executor_enabled', position('product_card_rebuilt' IN pg_get_functiondef(
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
  )) > 0,
  'target', (SELECT jsonb_build_object(
    'id', id, 'code', code, 'quantity_on_hand', quantity_on_hand,
    'updated_at', updated_at
  ) FROM target),
  'target_movements', (SELECT jsonb_build_object(
    'count', count(*),
    'quantity', COALESCE(sum(public.inventory_signed_quantity(movement_type::text, quantity)), 0),
    'book_value', COALESCE(sum(CASE
      WHEN movement_type::text = 'adjustment' THEN sign(COALESCE(quantity, 0)) * abs(COALESCE(total_cost, 0))
      WHEN movement_type::text IN ('sale', 'purchase_return') THEN -abs(COALESCE(total_cost, 0))
      ELSE abs(COALESCE(total_cost, 0))
    END), 0)
  ) FROM public.inventory_movements WHERE product_id = '${productId}'::uuid),
  'target_diagnostic', (SELECT row_data FROM target_diagnostic),
  'previous_repair', (SELECT jsonb_build_object(
    'repair_number', repair_number, 'status', status, 'version', version
  ) FROM public.inventory_reconciliation_repairs WHERE repair_number = 12),
  'active_target_repairs', (SELECT count(*)
    FROM public.inventory_reconciliation_repair_items i
    JOIN public.inventory_reconciliation_repairs r ON r.id = i.repair_id
    WHERE i.product_id = '${productId}'::uuid
      AND r.status IN ('draft', 'ready_for_review', 'approved')),
  'counts', jsonb_build_object(
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
  )
) AS baseline;
ROLLBACK;
`;

function main() {
  if (process.argv.length !== 2) throw new Error("هذا الفاحص لا يقبل معاملات");
  assertStagingLink();
  process.umask(0o077);
  const outputDir = mkdtempSync("/tmp/staging-inventory-stale-guard-before-");
  const schemaPath = join(outputDir, "public-schema.sql");
  const dataPath = join(outputDir, "public-data.sql");
  const queryPath = join(outputDir, "baseline-query.sql");
  const baselinePath = join(outputDir, "baseline.json");
  const manifestPath = join(outputDir, "manifest.json");
  const logPath = join(outputDir, "run.log");
  writeFileSync(queryPath, baselineSql, { mode: 0o600 });

  runCli(["db", "dump", "--linked", "--schema", "public", "--file", schemaPath], logPath);
  runCli(["db", "dump", "--linked", "--schema", "public", "--data-only", "--use-copy", "--file", dataPath], logPath);
  chmodSync(schemaPath, 0o600);
  chmodSync(dataPath, 0o600);
  if (statSync(schemaPath).size < 10_000 || statSync(dataPath).size < 10_000) {
    throw new Error(`نسخة Staging غير مكتملة؛ الملفات المحمية: ${outputDir}`);
  }
  const output = runCli(["db", "query", "--linked", "--output-format", "json", "--file", queryPath], logPath);
  const baseline = JSON.parse(output).rows?.[0]?.baseline;
  if (!baseline || baseline.database !== "postgres" || baseline.server_version !== "17.6"
      || !baseline.executor_recorded || !baseline.executor_enabled
      || baseline.target?.code !== "PRD-002" || baseline.target.quantity_on_hand !== 1
      || baseline.target_movements?.count !== 2 || baseline.target_movements.quantity !== 1
      || baseline.target_movements.book_value !== 130
      || baseline.target_diagnostic?.classification !== "matched"
      || baseline.previous_repair?.status !== "executed"
      || baseline.active_target_repairs !== 0) {
    throw new Error(`خط أساس Staging لم يعد يطابق حالة الاختبار المضبوطة؛ الملفات المحمية: ${outputDir}`);
  }
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 });
  const files = [schemaPath, dataPath, queryPath, baselinePath];
  const manifest = {
    result: "STAGING_INVENTORY_STALE_GUARD_BASELINE_OK",
    projectRef: expectedProjectRef,
    createdAt: new Date().toISOString(),
    readOnly: true,
    productionModified: false,
    files: Object.fromEntries(files.map((path) => [path.split("/").at(-1), {
      bytes: statSync(path).size, sha256: sha256(path),
    }])),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  const checksumPaths = [...files, manifestPath];
  writeFileSync(join(outputDir, "SHA256SUMS"), `${checksumPaths
    .map((path) => `${sha256(path)}  ${path.split("/").at(-1)}`).join("\n")}\n`, { mode: 0o600 });

  console.log("تم حفظ نسخة Staging وخط أساس اختبار الاقتراح القديم دون أي تعديل على القاعدة");
  console.log(`SOURCE_DIR=${outputDir}`);
  console.log(`COUNTS=${JSON.stringify(baseline.counts)}`);
  console.log("TARGET=PRD-002 CARD=1 MOVEMENTS=1 ACTIVE_REPAIRS=0");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
