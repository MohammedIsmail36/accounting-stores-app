// Read-only Staging backup and baseline before rehearsing stage 2D-A/2D-B.
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRefPath = join(root, "supabase/.temp/project-ref");
const expectedProjectRef = "dunzfxurefzlaamgghys";
const cli = "supabase@2.116.0";
const lifecycleVersion = "20260913234500";
const rebuildVersion = "20260914190000";
const systemAccountsVersion = "20260921213000";
const plannerVersion = "20260921220000";
const executorVersion = "20260921233000";

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
    timeout: 240000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    appendFileSync(logPath,
      `\n=== supabase ${args.join(" ")} ===\n${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\n`,
      { mode: 0o600 });
    throw new Error(`فشل إنشاء نسخة Staging قبل 2D-B؛ التشخيص المحمي: ${logPath}`);
  }
  return result.stdout;
}

const baselineSql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'project_ref', '${expectedProjectRef}',
  'migration_state', jsonb_build_object(
    'lifecycle_2b', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${lifecycleVersion}'),
    'rebuild_2c', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${rebuildVersion}'),
    'system_accounts', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${systemAccountsVersion}'),
    'planner_2da', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${plannerVersion}'),
    'executor_2db', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${executorVersion}')
  ),
  'function_state', jsonb_build_object(
    'diagnostic', to_regprocedure('public.get_inventory_reconciliation_diagnostic(text,boolean,text,integer,integer,text)') IS NOT NULL,
    'repair_executor', to_regprocedure('public.execute_inventory_reconciliation_repair(uuid,integer,uuid)') IS NOT NULL,
    'rebuild_enabled', position('product_card_rebuilt' IN pg_get_functiondef(
      'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure)) > 0,
    'missing_journal_enabled', position('missing_inventory_journal_created' IN pg_get_functiondef(
      'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure)) > 0,
    'journal_planner', to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NOT NULL,
    'planner_base_internal', to_regprocedure('public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)') IS NOT NULL,
    'rebuild_internal', to_regprocedure('public.execute_inventory_reconciliation_repair_rebuild_2c(uuid,integer,uuid)') IS NOT NULL
  ),
  'account_map', COALESCE((SELECT jsonb_object_agg(code, account_count ORDER BY code)
    FROM (SELECT code, count(*) AS account_count FROM public.accounts
      WHERE code IN ('1103','1104','1105','2101','2102','4101','4201','5101','5108','5201')
      GROUP BY code) mapped), '{}'::jsonb),
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
  const outputDir = `/tmp/staging-inventory-missing-journal-before-${stamp}`;
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
    throw new Error(`نسخة Staging غير مكتملة؛ الملفات المحمية: ${outputDir}`);
  }

  const queryOutput = runCli(
    ["db", "query", "--linked", "--output-format", "json", "--file", queryPath], logPath);
  const baseline = JSON.parse(queryOutput).rows?.[0]?.baseline;
  if (!baseline || baseline.database !== "postgres" || baseline.project_ref !== expectedProjectRef
      || !baseline.server_version?.startsWith("17.")) {
    throw new Error(`هوية Staging لا تطابق المتوقع؛ الملفات المحمية: ${outputDir}`);
  }
  const migrations = baseline.migration_state || {};
  const functions = baseline.function_state || {};
  if (!migrations.lifecycle_2b || !migrations.rebuild_2c || migrations.system_accounts
      || migrations.planner_2da
      || migrations.executor_2db || !functions.diagnostic || !functions.repair_executor
      || !functions.rebuild_enabled || functions.missing_journal_enabled
      || functions.journal_planner || functions.planner_base_internal || functions.rebuild_internal) {
    throw new Error(`خط أساس Staging لا يمثل الحالة الآمنة قبل 2D؛ الملفات المحمية: ${outputDir}`);
  }

  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 });
  const files = [schemaPath, dataPath, queryPath, baselinePath];
  const manifest = {
    result: "STAGING_INVENTORY_MISSING_JOURNAL_BASELINE_OK",
    projectRef: expectedProjectRef,
    createdAt: new Date().toISOString(),
    readOnly: true,
    plannerAbsent: true,
    executorAbsent: true,
    productionModified: false,
    files: Object.fromEntries(files.map((path) => [path.split("/").at(-1), {
      bytes: statSync(path).size,
      sha256: sha256(path),
    }])),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  const checksumPaths = [...files, manifestPath];
  writeFileSync(join(outputDir, "SHA256SUMS"), `${checksumPaths
    .map((path) => `${sha256(path)}  ${path.split("/").at(-1)}`).join("\n")}\n`, { mode: 0o600 });

  console.log("تم إنشاء نسخة Staging وخط أساس ما قبل 2D-B دون كتابة على القاعدة");
  console.log(`SOURCE_DIR=${outputDir}`);
  console.log(`COUNTS=${JSON.stringify(baseline.counts)}`);
  console.log(`ACCOUNT_MAP=${JSON.stringify(baseline.account_map)}`);
  console.log(`DIAGNOSTIC_STATUS=${baseline.diagnostic?.status}`);
  console.log("PLANNER_ABSENT=true EXECUTOR_2DB_ABSENT=true");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
