// Read-only aggregate closure gate for the nine accepted 2D mappings on Staging.
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extract } from "./backup-inventory-adjustment-surplus-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRef = "dunzfxurefzlaamgghys";
const cli = "supabase@2.116.0";
export const expectedSources = Object.freeze([
  [48, "purchase_invoice", "990021"],
  [49, "sales_invoice", "990022"],
  [50, "purchase_invoice", "990023"],
  [51, "sales_invoice", "990024"],
  [52, "sales_return", "990025"],
  [53, "purchase_return", "990026"],
  [54, "purchase_return", "990027"],
  [55, "adjustment", "990028"],
  [56, "adjustment", "990029"],
]);

export const verificationSql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
WITH targets(repair_number, source_type, source_number) AS (
  VALUES ${expectedSources.map(([number, type, sourceNumber]) => `(${number}, '${type}'::text, '${sourceNumber}'::text)`).join(",\n    ")}
), accepted AS (
  SELECT t.repair_number expected_repair_number, t.source_type expected_source_type,
    t.source_number expected_source_number, r.id repair_id, r.repair_number, r.status repair_status,
    r.version, r.accounting_date, i.source_type, i.source_id, i.source_number, i.result_status,
    (SELECT count(*) FROM public.inventory_reconciliation_repair_effects e WHERE e.repair_id = r.id) effect_count,
    (SELECT e.effect_type FROM public.inventory_reconciliation_repair_effects e WHERE e.repair_id = r.id LIMIT 1) effect_type,
    (SELECT e.record_id FROM public.inventory_reconciliation_repair_effects e WHERE e.repair_id = r.id LIMIT 1) effect_record_id,
    (SELECT count(*) FROM public.inventory_reconciliation_repair_events e WHERE e.repair_id = r.id) event_count
  FROM targets t LEFT JOIN public.inventory_reconciliation_repairs r ON r.repair_number = t.repair_number
  LEFT JOIN public.inventory_reconciliation_repair_items i ON i.repair_id = r.id
), linked AS (
  SELECT a.*, CASE a.source_type
    WHEN 'purchase_invoice' THEN (SELECT s.journal_entry_id FROM public.purchase_invoices s WHERE s.id = a.source_id)
    WHEN 'sales_invoice' THEN (SELECT s.journal_entry_id FROM public.sales_invoices s WHERE s.id = a.source_id)
    WHEN 'purchase_return' THEN (SELECT s.journal_entry_id FROM public.purchase_returns s WHERE s.id = a.source_id)
    WHEN 'sales_return' THEN (SELECT s.journal_entry_id FROM public.sales_returns s WHERE s.id = a.source_id)
    WHEN 'adjustment' THEN (SELECT s.journal_entry_id FROM public.inventory_adjustments s WHERE s.id = a.source_id)
    ELSE NULL END AS linked_journal_id,
    CASE a.source_type
    WHEN 'purchase_invoice' THEN (SELECT s.status FROM public.purchase_invoices s WHERE s.id = a.source_id)
    WHEN 'sales_invoice' THEN (SELECT s.status FROM public.sales_invoices s WHERE s.id = a.source_id)
    WHEN 'purchase_return' THEN (SELECT s.status FROM public.purchase_returns s WHERE s.id = a.source_id)
    WHEN 'sales_return' THEN (SELECT s.status FROM public.sales_returns s WHERE s.id = a.source_id)
    WHEN 'adjustment' THEN (SELECT s.status FROM public.inventory_adjustments s WHERE s.id = a.source_id)
    ELSE NULL END AS source_status
  FROM accepted a
), checks AS (
  SELECT l.*, j.status journal_status, j.posted_number, j.total_debit, j.total_credit,
    (SELECT count(*) FROM public.journal_entry_lines x WHERE x.journal_entry_id = j.id) line_count,
    (SELECT round(COALESCE(sum(x.debit), 0), 2) FROM public.journal_entry_lines x WHERE x.journal_entry_id = j.id) lines_debit,
    (SELECT round(COALESCE(sum(x.credit), 0), 2) FROM public.journal_entry_lines x WHERE x.journal_entry_id = j.id) lines_credit,
    CASE WHEN l.source_id IS NOT NULL THEN public.get_inventory_reconciliation_journal_plan(
      l.source_type, l.source_id, l.accounting_date)->>'reason_code' ELSE NULL END plan_reason,
    CASE WHEN l.source_id IS NOT NULL THEN (SELECT count(*) FROM jsonb_array_elements(
      public.get_inventory_reconciliation_diagnostic('sources', true, l.source_id::text, 500, 0, NULL)->'rows') row
      WHERE row->>'source_id' = l.source_id::text AND row->>'classification' <> 'matched') ELSE NULL END source_issue_count
  FROM linked l LEFT JOIN public.journal_entries j ON j.id = l.linked_journal_id
)
SELECT jsonb_build_object(
  'database', current_database(), 'server_version', current_setting('server_version'),
  'configured_prefix', (SELECT journal_entry_prefix FROM public.company_settings ORDER BY created_at LIMIT 1),
  'rows', (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.expected_repair_number), '[]'::jsonb) FROM checks c),
  'global', jsonb_build_object(
    'posted_without_number', (SELECT count(*) FROM public.journal_entries WHERE status = 'posted' AND (posted_number IS NULL OR posted_number <= 0)),
    'duplicate_posted_numbers', (SELECT count(*) FROM (SELECT posted_number FROM public.journal_entries
      WHERE status = 'posted' AND posted_number IS NOT NULL GROUP BY posted_number HAVING count(*) > 1) d),
    'products', (SELECT count(*) FROM public.products),
    'movements', (SELECT count(*) FROM public.inventory_movements),
    'adjustments', (SELECT count(*) FROM public.inventory_adjustments),
    'journals', (SELECT count(*) FROM public.journal_entries),
    'journal_lines', (SELECT count(*) FROM public.journal_entry_lines),
    'repairs', (SELECT count(*) FROM public.inventory_reconciliation_repairs),
    'effects', (SELECT count(*) FROM public.inventory_reconciliation_repair_effects),
    'diagnostic', public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)
  )
) AS inventory_2d_closure;
ROLLBACK;
`;

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

export function validateClosure(value) {
  const failures = [];
  if (value?.database !== "postgres" || !value?.server_version?.startsWith("17.")
      || typeof value?.configured_prefix !== "string" || !value.configured_prefix.trim()) failures.push("database_identity");
  const rows = value?.rows;
  if (!Array.isArray(rows) || rows.length !== expectedSources.length) failures.push("target_count");
  const postedNumbers = new Set();
  const journalIds = new Set();
  for (const [number, sourceType, sourceNumber] of expectedSources) {
    const row = rows?.find((entry) => Number(entry.expected_repair_number) === number);
    if (!row || Number(row.repair_number) !== number || row.repair_status !== "executed"
        || Number(row.version) !== 4 || row.source_type !== sourceType
        || row.source_number !== sourceNumber || row.expected_source_type !== sourceType
        || row.expected_source_number !== sourceNumber || row.result_status !== "applied"
        || row.source_status !== "posted") failures.push(`repair_${number}`);
    if (!row || Number(row.effect_count) !== 1 || row.effect_type !== "missing_inventory_journal_created"
        || row.effect_record_id !== row.linked_journal_id || Number(row.event_count) !== 4) failures.push(`effect_${number}`);
    if (!row || row.journal_status !== "posted" || !Number.isSafeInteger(Number(row.posted_number))
        || Number(row.posted_number) <= 0 || Number(row.total_debit) <= 0
        || Number(row.total_debit) !== Number(row.total_credit)
        || Number(row.lines_debit) !== Number(row.total_debit)
        || Number(row.lines_credit) !== Number(row.total_credit)
        || Number(row.line_count) < 2 || !row.linked_journal_id) failures.push(`journal_${number}`);
    if (!row || row.plan_reason !== "NO_CORRECTION_REQUIRED"
        || Number(row.source_issue_count) !== 0) failures.push(`reconciliation_${number}`);
    if (row?.posted_number) postedNumbers.add(row.posted_number);
    if (row?.linked_journal_id) journalIds.add(row.linked_journal_id);
  }
  if (postedNumbers.size !== expectedSources.length || journalIds.size !== expectedSources.length) failures.push("journal_uniqueness");
  const global = value?.global;
  const counts = { products: 617, movements: 1375, adjustments: 4,
    journals: 322, journal_lines: 865, repairs: 12, effects: 10 };
  for (const [key, count] of Object.entries(counts)) {
    if (Number(global?.[key]) !== count) failures.push(`global_${key}`);
  }
  if (Number(global?.posted_without_number) !== 0 || Number(global?.duplicate_posted_numbers) !== 0) failures.push("global_numbering");
  const diagnostic = global?.diagnostic;
  if (diagnostic?.status !== "rounding_only" || Number(diagnostic?.issue_counts?.sources) !== 2
      || Number(diagnostic?.issue_counts?.rounding) !== 2
      || Number(diagnostic?.issue_counts?.products) !== 0
      || Number(diagnostic?.issue_counts?.unlinked_journals) !== 0
      || Number(diagnostic?.issue_counts?.unlinked_movements) !== 0
      || Number(diagnostic?.totals?.quantity_difference) !== 0) failures.push("global_diagnostic");
  if (failures.length) throw new Error(`فشل إغلاق 2D المجمّع: ${failures.join(",")}`);
  return value;
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStaging();
  process.umask(0o077);
  const dir = mkdtempSync("/tmp/accounting-staging-inventory-2d-closure-");
  chmodSync(dir, 0o700);
  const sqlPath = join(dir, "verification.sql");
  const logPath = join(dir, "run.log");
  writeFileSync(sqlPath, verificationSql, { mode: 0o600 });
  const result = spawnSync("npx", ["-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", sqlPath], {
    cwd: root, env: cliEnvironment(), encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n`, { mode: 0o600 });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    throw new Error(`فشل استعلام إغلاق 2D؛ التشخيص: ${logPath}`);
  }
  const value = validateClosure(extract(result.stdout, "inventory_2d_closure"));
  writeFileSync(join(dir, "report.json"), `${JSON.stringify({ ...value,
    result: "STAGING_INVENTORY_2D_CLOSURE_OK", projectRef, readOnly: true,
    productionModified: false, verifiedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجح إغلاق 2D المجمّع للقراءة فقط على Staging؛ الحالات التسع منفذة وقيودها متزنة وانحرافاتها مغلقة");
  console.log("بقيت حالتا التقريب القديمتان فقط؛ لم تتغير الإنتاج أو قاعدة Staging أثناء الفحص");
  console.log(`REPORT_DIR=${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
