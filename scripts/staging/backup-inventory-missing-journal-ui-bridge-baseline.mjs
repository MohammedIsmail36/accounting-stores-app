// Read-only Staging backup and baseline before the stage 2D-C UI bridge.
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const cli = "supabase@2.116.0";
const versions = {
  systemAccounts: "20260921213000",
  planner: "20260921220000",
  executor: "20260921233000",
  bridge: "20260922070000",
};

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
    cwd: root,
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 96 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    appendFileSync(logPath,
      `\n=== supabase ${args.join(" ")} ===\n${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\n`,
      { mode: 0o600 });
    throw new Error(`فشل إنشاء نسخة Staging قبل جسر 2D؛ التشخيص: ${logPath}`);
  }
  return result.stdout;
}

export const baselineSql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'project_ref', '${expectedProjectRef}',
  'migration_state', jsonb_build_object(
    'system_accounts', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${versions.systemAccounts}'),
    'planner', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${versions.planner}'),
    'executor', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${versions.executor}'),
    'bridge', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${versions.bridge}')
  ),
  'bridge_state', jsonb_build_object(
    'function_exists', to_regprocedure('public.fn_prepare_inventory_missing_journal_repair_item()') IS NOT NULL,
    'trigger_count', (SELECT count(*) FROM pg_trigger
      WHERE tgrelid = 'public.inventory_reconciliation_repair_items'::regclass
        AND tgname = 'trg_prepare_inventory_missing_journal_repair_item' AND NOT tgisinternal),
    'active_repairs', (SELECT count(*) FROM public.inventory_reconciliation_repair_items i
      JOIN public.inventory_reconciliation_repairs r ON r.id = i.repair_id
      WHERE i.repair_type = 'create_missing_inventory_journal'
        AND r.status IN ('draft', 'ready_for_review', 'approved'))
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
) AS baseline;
ROLLBACK;
`;

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStagingLink();
  process.umask(0o077);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const outputDir = `/tmp/staging-inventory-missing-journal-ui-bridge-before-${stamp}`;
  mkdirSync(outputDir, { mode: 0o700 });
  chmodSync(outputDir, 0o700);
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
    throw new Error(`نسخة Staging غير مكتملة: ${outputDir}`);
  }
  const queryOutput = runCli(
    ["db", "query", "--linked", "--output-format", "json", "--file", queryPath], logPath);
  const baseline = JSON.parse(queryOutput).rows?.[0]?.baseline;
  const migrations = baseline?.migration_state ?? {};
  const bridge = baseline?.bridge_state ?? {};
  if (!baseline || baseline.database !== "postgres" || baseline.project_ref !== expectedProjectRef
      || !baseline.server_version?.startsWith("17.")
      || !migrations.system_accounts || !migrations.planner || !migrations.executor
      || migrations.bridge || bridge.function_exists || bridge.trigger_count !== 0
      || bridge.active_repairs !== 0) {
    throw new Error(`خط أساس Staging قبل جسر 2D غير آمن: ${outputDir}`);
  }
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 });
  const files = [schemaPath, dataPath, queryPath, baselinePath];
  const manifest = {
    result: "STAGING_INVENTORY_MISSING_JOURNAL_UI_BRIDGE_BASELINE_OK",
    projectRef: expectedProjectRef,
    createdAt: new Date().toISOString(),
    readOnly: true,
    bridgeAbsent: true,
    productionModified: false,
    files: Object.fromEntries(files.map((path) => [path.split("/").at(-1), {
      bytes: statSync(path).size,
      sha256: sha256(path),
    }])),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(outputDir, "SHA256SUMS"), `${[...files, manifestPath]
    .map((path) => `${sha256(path)}  ${path.split("/").at(-1)}`).join("\n")}\n`, { mode: 0o600 });
  console.log("تم إنشاء نسخة Staging وخط أساس ما قبل جسر 2D دون كتابة على القاعدة");
  console.log(`SOURCE_DIR=${outputDir}`);
  console.log(`COUNTS=${JSON.stringify(baseline.counts)}`);
  console.log(`DIAGNOSTIC_STATUS=${baseline.diagnostic?.status}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
