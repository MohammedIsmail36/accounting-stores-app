// Read-only public-schema/data backup before the inventory repair lifecycle.
import {
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
const repairVersion = "20260913234500";

export function validateBackupSource(source) {
  for (const required of [
    expectedProjectRef,
    "BEGIN TRANSACTION READ ONLY;",
    "ROLLBACK;",
    "--linked",
    "--data-only",
    "--use-copy",
    repairVersion,
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

function runCli(args) {
  const result = spawnSync("npx", ["-y", cli, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    const safeMessage = (result.stderr || result.error?.message || "فشل Supabase CLI")
      .trim().split("\n").slice(-1)[0];
    throw new Error(`فشل إنشاء نسخة Staging: ${safeMessage}`);
  }
  return result.stdout;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function main() {
  if (process.argv.length > 2) throw new Error("هذا المشغل لا يقبل معاملات");
  validateBackupSource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  const linkedRef = readFileSync(projectRefPath, "utf8").trim();
  if (linkedRef !== expectedProjectRef) {
    throw new Error(`رفض التنفيذ: المشروع المرتبط ${linkedRef || "غير موجود"} ليس Staging المعتمد`);
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/T/, "-").slice(0, 15);
  const outputDir = `/tmp/staging-inventory-repair-before-${stamp}`;
  mkdirSync(outputDir, { mode: 0o700 });
  chmodSync(outputDir, 0o700);
  const schemaPath = join(outputDir, "public-schema.sql");
  const dataPath = join(outputDir, "public-data.sql");
  const queryPath = join(outputDir, "baseline-query.sql");
  const baselinePath = join(outputDir, "baseline.json");
  const manifestPath = join(outputDir, "manifest.json");

  const baselineSql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT jsonb_build_object(
  'database', current_database(),
  'role', current_user,
  'server_version', current_setting('server_version'),
  'repair_migration_recorded', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${repairVersion}'
  ),
  'repair_objects', jsonb_build_object(
    'repairs', to_regclass('public.inventory_reconciliation_repairs') IS NOT NULL,
    'items', to_regclass('public.inventory_reconciliation_repair_items') IS NOT NULL,
    'effects', to_regclass('public.inventory_reconciliation_repair_effects') IS NOT NULL,
    'events', to_regclass('public.inventory_reconciliation_repair_events') IS NOT NULL,
    'create_rpc', to_regprocedure('public.create_inventory_reconciliation_repair(text,text,text,timestamptz,text,jsonb,uuid)') IS NOT NULL
  ),
  'counts', jsonb_build_object(
    'products', (SELECT count(*) FROM public.products),
    'inventory_movements', (SELECT count(*) FROM public.inventory_movements),
    'sales_invoices', (SELECT count(*) FROM public.sales_invoices),
    'purchase_invoices', (SELECT count(*) FROM public.purchase_invoices),
    'sales_returns', (SELECT count(*) FROM public.sales_returns),
    'purchase_returns', (SELECT count(*) FROM public.purchase_returns),
    'inventory_adjustments', (SELECT count(*) FROM public.inventory_adjustments),
    'journal_entries', (SELECT count(*) FROM public.journal_entries),
    'journal_entry_lines', (SELECT count(*) FROM public.journal_entry_lines)
  ),
  'signatures', jsonb_build_object(
    'products', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.products p),
    'inventory_movements', (SELECT md5(COALESCE(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id), '')) FROM public.inventory_movements m),
    'sales_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), '')) FROM public.sales_invoices s),
    'purchase_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.purchase_invoices p),
    'journal_entries', (SELECT md5(COALESCE(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id), '')) FROM public.journal_entries j),
    'journal_entry_lines', (SELECT md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), '')) FROM public.journal_entry_lines l)
  ),
  'diagnostic', public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)
) AS baseline;
ROLLBACK;
`;
  writeFileSync(queryPath, baselineSql, { mode: 0o600 });

  runCli(["db", "dump", "--linked", "--schema", "public", "--file", schemaPath]);
  runCli(["db", "dump", "--linked", "--schema", "public", "--data-only", "--use-copy", "--file", dataPath]);
  chmodSync(schemaPath, 0o600);
  chmodSync(dataPath, 0o600);
  const queryOutput = runCli(["db", "query", "--linked", "--output-format", "json", "--file", queryPath]);
  const parsed = JSON.parse(queryOutput);
  const baseline = parsed.rows?.[0]?.baseline;
  if (!baseline || baseline.database !== "postgres" || baseline.server_version !== "17.6") {
    throw new Error("هوية قاعدة Staging أو إصدارها لا يطابقان المتوقع");
  }
  if (baseline.repair_migration_recorded
      || Object.values(baseline.repair_objects || {}).some(Boolean)) {
    throw new Error("مكونات 2B موجودة قبل النسخة؛ أُوقف الإجراء");
  }

  const schema = readFileSync(schemaPath, "utf8");
  const data = readFileSync(dataPath, "utf8");
  if (!/CREATE TABLE(?: IF NOT EXISTS)? "public"\."products"/.test(schema)
      || !/FUNCTION "public"\."get_inventory_reconciliation_diagnostic"/.test(schema)
      || schema.includes("inventory_reconciliation_repairs")) {
    throw new Error("محتوى نسخة المخطط لا يطابق حالة ما قبل 2B");
  }
  if (!/^COPY "public"\."products" /m.test(data)
      || !/^COPY "public"\."inventory_movements" /m.test(data)) {
    throw new Error("نسخة البيانات لا تحتوي كتل COPY الأساسية");
  }

  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 });
  const files = [schemaPath, dataPath, queryPath, baselinePath];
  const manifest = {
    result: "STAGING_INVENTORY_REPAIR_BASELINE_BACKUP_OK",
    createdAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    repairVersion,
    readOnlyBaseline: true,
    repairObjectsAbsent: true,
    productionModified: false,
    files: Object.fromEntries(files.map((path) => [path.split("/").at(-1), {
      bytes: statSync(path).size,
      sha256: sha256(path),
    }])),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  const checksumPaths = [...files, manifestPath];
  const checksumText = checksumPaths
    .map((path) => `${sha256(path)}  ${path.split("/").at(-1)}`)
    .join("\n");
  writeFileSync(join(outputDir, "SHA256SUMS"), `${checksumText}\n`, { mode: 0o600 });

  console.log("تم إنشاء نسخة Staging الحديثة وخط الأساس والتحقق منهما دون كتابة على القاعدة");
  console.log(`SOURCE_DIR=${outputDir}`);
  console.log(`PRODUCTS=${baseline.counts.products} MOVEMENTS=${baseline.counts.inventory_movements}`);
  console.log(`DIAGNOSTIC_STATUS=${baseline.diagnostic.status}`);
  console.log("REPAIR_OBJECTS_ABSENT=true");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
