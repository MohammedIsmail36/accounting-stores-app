// Read-only verifier for each Staging taxed-sale repair acceptance phase.
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extract, fixture } from "./backup-inventory-tax-sales-acceptance-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRef = "dunzfxurefzlaamgghys";
const archive = "/backups/staging/inventory-tax-sales-acceptance-before-20260923-145639";
const cli = "supabase@2.116.0";
const phases = Object.freeze({
  "--draft": { status: "draft", version: 1, event: "created" },
  "--submitted": { status: "ready_for_review", version: 2, event: "submitted" },
  "--approved": { status: "approved", version: 3, event: "approved" },
  "--executed": { status: "executed", version: 4, event: "executed" },
});

const expectedLines = [
  { account_code: "1103", debit: 114, credit: 0 },
  { account_code: "1104", debit: 0, credit: 80 },
  { account_code: "2104", debit: 0, credit: 14 },
  { account_code: "4101", debit: 0, credit: 100 },
  { account_code: "5101", debit: 80, credit: 0 },
];

function comparableLines(lines) {
  return [...(lines ?? [])].map((line) => ({ account_code: String(line.account_code),
    debit: Number(line.debit), credit: Number(line.credit) })).sort((a, b) => a.account_code.localeCompare(b.account_code));
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

export const verificationSql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
WITH target AS (
  SELECT r.* FROM public.inventory_reconciliation_repairs r
  JOIN public.inventory_reconciliation_repair_items i ON i.repair_id = r.id
  WHERE i.source_type = 'sales_invoice' AND i.source_id = '${fixture.invoiceId}'::uuid
), target_item AS (
  SELECT i.* FROM public.inventory_reconciliation_repair_items i JOIN target r ON r.id = i.repair_id
), event_counts AS (
  SELECT e.event_type, count(*)::integer AS count FROM public.inventory_reconciliation_repair_events e
  JOIN target r ON r.id = e.repair_id GROUP BY e.event_type
), source_row AS (
  SELECT value AS row FROM jsonb_array_elements(public.get_inventory_reconciliation_diagnostic(
    'sources', true, '${fixture.invoiceId}', 500, 0, NULL
  )->'rows') WHERE value->>'source_type' = 'sales_invoice' AND value->>'source_id' = '${fixture.invoiceId}' LIMIT 1
)
SELECT jsonb_build_object(
  'database', current_database(), 'server_version', current_setting('server_version'),
  'configured_prefix', (SELECT journal_entry_prefix FROM public.company_settings ORDER BY created_at LIMIT 1),
  'tax_settings', (SELECT jsonb_build_object('enable_tax', s.enable_tax, 'tax_rate', s.tax_rate,
    'purchase_code', p.code, 'sales_code', v.code) FROM public.company_settings s
    JOIN public.accounts p ON p.id = s.purchase_tax_account_id
    JOIN public.accounts v ON v.id = s.sales_tax_account_id ORDER BY s.created_at LIMIT 1),
  'repair', (SELECT jsonb_build_object('id', r.id, 'repair_number', r.repair_number, 'status', r.status,
    'version', r.version, 'prepared_by', r.prepared_by, 'submitted_by', r.submitted_by,
    'approved_by', r.approved_by, 'executed_by', r.executed_by) FROM target r),
  'item', (SELECT jsonb_build_object('axis', i.axis, 'classification', i.classification,
    'repair_type', i.repair_type, 'source_type', i.source_type, 'source_id', i.source_id,
    'source_number', i.source_number, 'result_status', i.result_status,
    'precondition_hash', i.precondition_hash, 'proposed_state', i.proposed_state) FROM target_item i),
  'events', COALESCE((SELECT jsonb_object_agg(event_type, count) FROM event_counts), '{}'::jsonb),
  'effect_count', (SELECT count(*) FROM public.inventory_reconciliation_repair_effects e JOIN target r ON r.id = e.repair_id),
  'effect', (SELECT jsonb_build_object('effect_type', e.effect_type, 'table_name', e.table_name,
    'record_id', e.record_id) FROM public.inventory_reconciliation_repair_effects e JOIN target r ON r.id = e.repair_id
    ORDER BY e.created_at DESC LIMIT 1),
  'source', (SELECT jsonb_build_object('invoice_number', s.invoice_number, 'status', s.status,
    'subtotal', s.subtotal, 'tax', s.tax, 'total', s.total, 'journal_entry_id', s.journal_entry_id)
    FROM public.sales_invoices s WHERE s.id = '${fixture.invoiceId}'::uuid),
  'opening', (SELECT jsonb_build_object('movement_type', m.movement_type, 'quantity', m.quantity,
    'total_cost', m.total_cost, 'reference_type', m.reference_type,
    'journal_id', j.id, 'journal_status', j.status, 'journal_posted_number', j.posted_number,
    'journal_debit', j.total_debit, 'journal_credit', j.total_credit,
    'line_count', (SELECT count(*) FROM public.journal_entry_lines l WHERE l.journal_entry_id = j.id))
    FROM public.inventory_movements m JOIN public.journal_entries j ON j.id = m.reference_id
    WHERE m.id = '${fixture.openingMovementId}'::uuid),
  'product', (SELECT jsonb_build_object('quantity', p.quantity_on_hand, 'purchase_price', p.purchase_price)
    FROM public.products p WHERE p.id = '${fixture.productId}'::uuid),
  'sale_movement_count', (SELECT count(*) FROM public.inventory_movements
    WHERE id = '${fixture.saleMovementId}'::uuid AND reference_type = 'sales_invoice'
      AND reference_id = '${fixture.invoiceId}'::uuid AND movement_type = 'sale'
      AND quantity = 2 AND total_cost = 80),
  'diagnostic_row', (SELECT row FROM source_row),
  'live_plan', public.get_inventory_reconciliation_journal_plan(
    'sales_invoice', '${fixture.invoiceId}'::uuid, (SELECT accounting_date FROM target LIMIT 1)),
  'journal', (SELECT jsonb_build_object('id', j.id, 'status', j.status,
    'posted_number', j.posted_number, 'total_debit', j.total_debit, 'total_credit', j.total_credit,
    'lines', (SELECT jsonb_agg(jsonb_build_object('account_code', a.code,
      'debit', l.debit, 'credit', l.credit) ORDER BY a.code)
      FROM public.journal_entry_lines l JOIN public.accounts a ON a.id = l.account_id
      WHERE l.journal_entry_id = j.id)) FROM public.journal_entries j
    WHERE j.id = (SELECT s.journal_entry_id FROM public.sales_invoices s WHERE s.id = '${fixture.invoiceId}'::uuid)),
  'counts', jsonb_build_object(
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
  )
) AS tax_sales_verification;
ROLLBACK;
`;

export function validateVerification(value, phase, baseline) {
  const expected = phases[phase];
  if (!expected) throw new Error("مرحلة تحقق غير مدعومة");
  const failures = [];
  const repair = value?.repair;
  const item = value?.item;
  const source = value?.source;
  const events = value?.events ?? {};
  const counts = value?.counts ?? {};
  const executed = phase === "--executed";
  const proposed = comparableLines(item?.proposed_state?.correction_lines);
  if (value?.database !== "postgres" || !value?.server_version?.startsWith("17.")
      || typeof value?.configured_prefix !== "string" || !value.configured_prefix.trim()) failures.push("database_identity");
  if (value?.tax_settings?.enable_tax !== true || Number(value?.tax_settings?.tax_rate) !== 14
      || value?.tax_settings?.purchase_code !== "1105" || value?.tax_settings?.sales_code !== "2104") failures.push("tax_settings");
  if (repair?.repair_number !== 51 || repair?.status !== expected.status || repair?.version !== expected.version
      || !repair?.prepared_by) failures.push("repair_header");
  if (item?.axis !== "source" || item?.classification !== "movement_without_journal"
      || item?.repair_type !== "create_missing_inventory_journal"
      || item?.source_type !== "sales_invoice" || item?.source_id !== fixture.invoiceId
      || item?.source_number !== String(fixture.invoiceNumber) || !item?.precondition_hash) failures.push("repair_item");
  if (source?.invoice_number !== fixture.invoiceNumber || source?.status !== "posted"
      || Number(source?.subtotal) !== 100 || Number(source?.tax) !== 14 || Number(source?.total) !== 114) failures.push("source");
  if (Number(value?.product?.quantity) !== 8 || Number(value?.product?.purchase_price) !== 40
      || Number(value?.sale_movement_count) !== 1) failures.push("inventory_evidence");
  if (value?.opening?.movement_type !== "opening_balance" || value?.opening?.reference_type !== "staging_seed"
      || value?.opening?.journal_status !== "posted" || !Number.isInteger(value?.opening?.journal_posted_number)
      || Number(value?.opening?.quantity) !== 10 || Number(value?.opening?.total_cost) !== 400
      || Number(value?.opening?.journal_debit) !== 400 || Number(value?.opening?.journal_credit) !== 400
      || Number(value?.opening?.line_count) !== 2) failures.push("opening_balance");
  if (JSON.stringify(proposed) !== JSON.stringify(comparableLines(expectedLines))
      || item?.proposed_state?.mode !== "create_full_journal" || !item?.proposed_state?.plan_fingerprint) failures.push("stored_plan");
  const expectedEvents = ["created", "submitted", "approved", "executed"].slice(0, expected.version);
  if (Object.keys(events).length !== expected.version
      || expectedEvents.some((event) => Number(events[event]) !== 1)) failures.push("events");
  const deltas = { products: 1, inventory_movements: 2, sales_invoices: 1, sales_invoice_items: 1,
    purchase_invoices: 0, journal_entries: 1 + (executed ? 1 : 0),
    journal_entry_lines: 2 + (executed ? 5 : 0), repairs: 1, repair_items: 1,
    repair_effects: executed ? 1 : 0, repair_events: expected.version };
  for (const [key, delta] of Object.entries(deltas)) {
    if (Number(counts[key]) !== Number(baseline?.counts?.[key]) + delta) failures.push(`count_${key}`);
  }
  if (!executed) {
    const live = comparableLines(value?.live_plan?.correction_lines);
    if (source?.journal_entry_id !== null || item?.result_status !== "pending"
        || Number(value?.effect_count) !== 0 || value?.effect !== null
        || value?.live_plan?.eligible !== true || value?.live_plan?.reason_code !== "READY"
        || value?.live_plan?.plan_fingerprint !== item?.proposed_state?.plan_fingerprint
        || JSON.stringify(live) !== JSON.stringify(comparableLines(expectedLines))
        || value?.diagnostic_row?.classification !== "movement_without_journal") failures.push("pre_execution_state");
  } else {
    const journal = value?.journal;
    if (!source?.journal_entry_id || item?.result_status !== "applied" || Number(value?.effect_count) !== 1
        || value?.effect?.effect_type !== "missing_inventory_journal_created"
        || value?.effect?.table_name !== "journal_entries" || value?.effect?.record_id !== source.journal_entry_id
        || journal?.id !== source.journal_entry_id || journal?.status !== "posted"
        || !Number.isInteger(journal?.posted_number) || Number(journal?.total_debit) !== 194
        || Number(journal?.total_credit) !== 194
        || JSON.stringify(comparableLines(journal?.lines)) !== JSON.stringify(comparableLines(expectedLines))
        || value?.live_plan?.eligible !== false || value?.live_plan?.reason_code !== "NO_CORRECTION_REQUIRED") failures.push("execution_state");
  }
  if (failures.length) throw new Error(`فشل تحقق قبول البيع الضريبي: ${failures.join(",")}`);
  return value;
}

function main() {
  const phase = process.argv[2];
  if (!phases[phase] || process.argv.length !== 3) throw new Error("استخدم --draft أو --submitted أو --approved أو --executed");
  assertStaging();
  process.umask(0o077);
  const dir = mkdtempSync(`/tmp/accounting-staging-tax-sales-${phase.slice(2)}-verification-`);
  chmodSync(dir, 0o700);
  const sqlPath = join(dir, "verification.sql");
  const logPath = join(dir, "run.log");
  writeFileSync(sqlPath, verificationSql, { mode: 0o600 });
  const result = spawnSync("npx", ["-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", sqlPath], {
    cwd: root, env: cliEnvironment(), encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n`, { mode: 0o600 });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    throw new Error(`فشل استعلام تحقق البيع الضريبي؛ التشخيص: ${logPath}`);
  }
  const baseline = JSON.parse(readFileSync(join(archive, "baseline.json"), "utf8"));
  const value = validateVerification(extract(result.stdout, "tax_sales_verification"), phase, baseline);
  const officialJournalNumber = phase === "--executed"
    ? `${value.configured_prefix}${String(value.journal.posted_number).padStart(4, "0")}` : null;
  writeFileSync(join(dir, "report.json"), `${JSON.stringify({ ...value, phase, officialJournalNumber,
    projectRef, readOnly: true, productionModified: false, verifiedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  console.log(`نجح تحقق البيع الضريبي في مرحلة ${phase.slice(2)} دون كتابة على Staging`);
  console.log(`REPAIR=IR-${String(value.repair.repair_number).padStart(4, "0")} STATUS=${value.repair.status} VERSION=${value.repair.version}`);
  if (officialJournalNumber) console.log(`JOURNAL=${officialJournalNumber}`);
  console.log(`REPORT_DIR=${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
