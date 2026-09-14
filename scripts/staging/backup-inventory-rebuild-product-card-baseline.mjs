// Read-only Staging backup and baseline before applying the stage-2C executor.
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const cli = "supabase@2.116.0";
const lifecycleVersion = "20260913234500";
const executorVersion = "20260914190000";

export function validateRebuildBaselineSource(source) {
  for (const required of [
    expectedProjectRef,
    "BEGIN TRANSACTION READ ONLY;",
    "ROLLBACK;",
    "--linked",
    "--data-only",
    "--use-copy",
    lifecycleVersion,
    executorVersion,
    "REPAIR_TYPE_NOT_ENABLED",
  ]) {
    if (!source.includes(required)) throw new Error(`حاجز النسخة مفقود: ${required}`);
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

function runCli(args, logPath) {
  const result = spawnSync("npx", ["-y", cli, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    appendFileSync(
      logPath,
      `\n=== supabase ${args.join(" ")} ===\n${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.stack ?? ""}\n`,
      { mode: 0o600 },
    );
    const safeMessage = (result.stderr || result.error?.message || "فشل Supabase CLI")
      .trim().split("\n").slice(-1)[0];
    throw new Error(`فشل إنشاء نسخة Staging قبل 2C: ${safeMessage}\nالتشخيص المحمي: ${logPath}`);
  }
  return result.stdout;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function main() {
  if (process.argv.length > 2) throw new Error("هذا المشغل لا يقبل معاملات");
  validateRebuildBaselineSource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  const linkedRef = readFileSync(projectRefPath, "utf8").trim();
  if (linkedRef !== expectedProjectRef) {
    throw new Error(`رفض التنفيذ: المشروع المرتبط ${linkedRef || "غير موجود"} ليس Staging المعتمد`);
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/T/, "-").slice(0, 15);
  const outputDir = `/tmp/staging-inventory-rebuild-before-${stamp}`;
  mkdirSync(outputDir, { mode: 0o700 });
  chmodSync(outputDir, 0o700);
  const schemaPath = join(outputDir, "public-schema.sql");
  const dataPath = join(outputDir, "public-data.sql");
  const queryPath = join(outputDir, "baseline-query.sql");
  const baselinePath = join(outputDir, "baseline.json");
  const manifestPath = join(outputDir, "manifest.json");
  const logPath = join(outputDir, "run.log");

  const baselineSql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT jsonb_build_object(
  'database', current_database(),
  'role', current_user,
  'server_version', current_setting('server_version'),
  'lifecycle_migration_recorded', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${lifecycleVersion}'
  ),
  'executor_migration_recorded', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${executorVersion}'
  ),
  'repair_objects', jsonb_build_object(
    'repairs', to_regclass('public.inventory_reconciliation_repairs') IS NOT NULL,
    'items', to_regclass('public.inventory_reconciliation_repair_items') IS NOT NULL,
    'effects', to_regclass('public.inventory_reconciliation_repair_effects') IS NOT NULL,
    'events', to_regclass('public.inventory_reconciliation_repair_events') IS NOT NULL,
    'execute_rpc', to_regprocedure('public.execute_inventory_reconciliation_repair(uuid,integer,uuid)') IS NOT NULL
  ),
  'executor_enabled', position('product_card_rebuilt' IN pg_get_functiondef(
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
  )) > 0,
  'executor_guarded', position('REPAIR_TYPE_NOT_ENABLED' IN pg_get_functiondef(
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
  )) > 0,
  'counts', jsonb_build_object(
    'products', (SELECT count(*) FROM public.products),
    'inventory_movements', (SELECT count(*) FROM public.inventory_movements),
    'sales_invoices', (SELECT count(*) FROM public.sales_invoices),
    'purchase_invoices', (SELECT count(*) FROM public.purchase_invoices),
    'sales_returns', (SELECT count(*) FROM public.sales_returns),
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
    'purchase_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.purchase_invoices p),
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
  writeFileSync(queryPath, baselineSql, { mode: 0o600 });

  runCli(["db", "dump", "--linked", "--schema", "public", "--file", schemaPath], logPath);
  runCli(["db", "dump", "--linked", "--schema", "public", "--data-only", "--use-copy", "--file", dataPath], logPath);
  chmodSync(schemaPath, 0o600);
  chmodSync(dataPath, 0o600);
  const queryOutput = runCli(["db", "query", "--linked", "--output-format", "json", "--file", queryPath], logPath);
  const parsed = JSON.parse(queryOutput);
  const baseline = parsed.rows?.[0]?.baseline;

  if (!baseline || baseline.database !== "postgres" || baseline.server_version !== "17.6") {
    throw new Error("هوية قاعدة Staging أو إصدارها لا يطابقان المتوقع");
  }
  if (!baseline.lifecycle_migration_recorded
      || baseline.executor_migration_recorded
      || !Object.values(baseline.repair_objects || {}).every(Boolean)
      || baseline.executor_enabled
      || !baseline.executor_guarded) {
    throw new Error("حالة دورة 2B أو منفذ 2C على Staging لا تطابق نقطة البداية الآمنة");
  }

  const schema = readFileSync(schemaPath, "utf8");
  const data = readFileSync(dataPath, "utf8");
  if (!/CREATE TABLE(?: IF NOT EXISTS)? "public"\."inventory_reconciliation_repairs"/.test(schema)
      || !/FUNCTION "public"\."execute_inventory_reconciliation_repair"/.test(schema)
      || !schema.includes("REPAIR_TYPE_NOT_ENABLED")
      || schema.includes("product_card_rebuilt")) {
    throw new Error("نسخة المخطط لا تمثل حالة 2B المحجوبة قبل 2C");
  }
  if (!/^COPY "public"\."products" /m.test(data)
      || !/^COPY "public"\."inventory_movements" /m.test(data)
      || !/^COPY "public"\."inventory_reconciliation_repairs" /m.test(data)) {
    throw new Error("نسخة البيانات لا تحتوي كتل COPY الأساسية ودورة المعالجة");
  }

  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 });
  const files = [schemaPath, dataPath, queryPath, baselinePath];
  const manifest = {
    result: "STAGING_INVENTORY_REBUILD_BASELINE_BACKUP_OK",
    createdAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    lifecycleVersion,
    executorVersion,
    readOnlyBaseline: true,
    lifecyclePresent: true,
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
    .map((path) => `${sha256(path)}  ${path.split("/").at(-1)}`)
    .join("\n")}\n`, { mode: 0o600 });

  console.log("تم إنشاء نسخة Staging الحديثة وخط أساس ما قبل 2C دون كتابة على القاعدة");
  console.log(`SOURCE_DIR=${outputDir}`);
  console.log(`PRODUCTS=${baseline.counts.products} MOVEMENTS=${baseline.counts.inventory_movements}`);
  console.log(`REPAIRS=${baseline.counts.repairs} EFFECTS=${baseline.counts.repair_effects}`);
  console.log(`DIAGNOSTIC_STATUS=${baseline.diagnostic.status}`);
  console.log("EXECUTOR_ABSENT=true");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
