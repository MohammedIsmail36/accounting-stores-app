// Read-only verifier for the controlled stage-2D purchase acceptance lifecycle on Staging.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const cli = "supabase@2.116.0";
const sourceId = "2d2d0000-0000-4000-8000-000000000102";
const productId = "2d2d0000-0000-4000-8000-000000000101";
const invoiceNumber = 990021;
const baseline = {
  products: 613,
  inventoryMovements: 1364,
  purchaseInvoices: 31,
  journalEntries: 311,
  journalEntryLines: 831,
  repairs: 3,
  repairItems: 3,
  repairEffects: 1,
  repairEvents: 12,
};

const phases = {
  "--draft": { status: "draft", version: 1, events: { created: 1 } },
  "--submitted": { status: "ready_for_review", version: 2, events: { created: 1, submitted: 1 } },
  "--approved": { status: "approved", version: 3, events: { created: 1, submitted: 1, approved: 1 } },
  "--executed": { status: "executed", version: 4, events: { created: 1, submitted: 1, approved: 1, executed: 1 } },
};

function runCli(sqlPath, logPath) {
  const result = spawnSync("npx", [
    "-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", sqlPath,
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  writeFileSync(logPath, output, { mode: 0o600 });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    throw new Error(`فشل تحقق قبول 2D؛ التشخيص المحمي: ${logPath}`);
  }
  return JSON.parse(result.stdout);
}

function comparableLines(lines) {
  return [...(lines ?? [])]
    .map((line) => ({
      account_code: String(line.account_code),
      debit: Number(line.debit),
      credit: Number(line.credit),
    }))
    .sort((a, b) => a.account_code.localeCompare(b.account_code));
}

function main() {
  const mode = process.argv[2];
  if (!phases[mode] || process.argv.length !== 3) {
    throw new Error("استخدم --draft أو --submitted أو --approved أو --executed");
  }
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }
  const expected = phases[mode];
  const reportDir = mkdtempSync(`/tmp/accounting-staging-2d-purchase-${mode.slice(2)}-verification-`);
  const sqlPath = join(reportDir, "verification.sql");
  const logPath = join(reportDir, "run.log");
  const reportPath = join(reportDir, "report.json");
  const sql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
WITH target AS (
  SELECT r.*
  FROM public.inventory_reconciliation_repairs r
  JOIN public.inventory_reconciliation_repair_items i ON i.repair_id = r.id
  WHERE i.source_type = 'purchase_invoice' AND i.source_id = '${sourceId}'::uuid
), target_item AS (
  SELECT i.* FROM public.inventory_reconciliation_repair_items i
  JOIN target r ON r.id = i.repair_id
), event_counts AS (
  SELECT e.event_type, count(*)::integer AS count
  FROM public.inventory_reconciliation_repair_events e
  JOIN target r ON r.id = e.repair_id GROUP BY e.event_type
), source_row AS (
  SELECT value AS row
  FROM jsonb_array_elements(public.get_inventory_reconciliation_diagnostic(
    'sources', true, '${sourceId}', 500, 0, NULL
  )->'rows')
  WHERE value->>'source_type' = 'purchase_invoice'
    AND value->>'source_id' = '${sourceId}' LIMIT 1
)
SELECT jsonb_build_object(
  'result', 'STAGING_2D_PURCHASE_ACCEPTANCE_VERIFIED',
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'repair', (SELECT jsonb_build_object(
    'id', r.id, 'repair_number', r.repair_number, 'status', r.status, 'version', r.version,
    'accounting_date', r.accounting_date, 'prepared_by', r.prepared_by,
    'submitted_by', r.submitted_by, 'approved_by', r.approved_by, 'executed_by', r.executed_by,
    'separation_override_reason', r.separation_override_reason
  ) FROM target r),
  'item', (SELECT jsonb_build_object(
    'id', i.id, 'axis', i.axis, 'classification', i.classification,
    'repair_type', i.repair_type, 'source_type', i.source_type,
    'source_id', i.source_id, 'source_number', i.source_number,
    'result_status', i.result_status, 'precondition_hash', i.precondition_hash,
    'proposed_state', i.proposed_state
  ) FROM target_item i),
  'events', COALESCE((SELECT jsonb_object_agg(event_type, count) FROM event_counts), '{}'::jsonb),
  'effects', (SELECT count(*) FROM public.inventory_reconciliation_repair_effects e JOIN target r ON r.id = e.repair_id),
  'effect', (SELECT jsonb_build_object('effect_type', e.effect_type, 'table_name', e.table_name,
    'record_id', e.record_id, 'after_data', e.after_data)
    FROM public.inventory_reconciliation_repair_effects e JOIN target r ON r.id = e.repair_id
    ORDER BY e.created_at DESC LIMIT 1),
  'source', (SELECT jsonb_build_object('invoice_number', p.invoice_number, 'status', p.status,
    'subtotal', p.subtotal, 'tax', p.tax, 'total', p.total, 'journal_entry_id', p.journal_entry_id)
    FROM public.purchase_invoices p WHERE p.id = '${sourceId}'::uuid),
  'journal', (SELECT jsonb_build_object(
    'id', j.id, 'status', j.status, 'entry_type', j.entry_type,
    'total_debit', j.total_debit, 'total_credit', j.total_credit,
    'line_count', (SELECT count(*) FROM public.journal_entry_lines l WHERE l.journal_entry_id = j.id)
  ) FROM public.journal_entries j
    WHERE j.id = (SELECT p.journal_entry_id FROM public.purchase_invoices p WHERE p.id = '${sourceId}'::uuid)),
  'product', (SELECT jsonb_build_object('quantity_on_hand', p.quantity_on_hand,
    'purchase_price', p.purchase_price) FROM public.products p WHERE p.id = '${productId}'::uuid),
  'diagnostic_row', (SELECT row FROM source_row),
  'live_plan', public.get_inventory_reconciliation_journal_plan(
    'purchase_invoice', '${sourceId}'::uuid,
    (SELECT accounting_date FROM target LIMIT 1)
  ),
  'counts', jsonb_build_object(
    'products', (SELECT count(*) FROM public.products),
    'inventory_movements', (SELECT count(*) FROM public.inventory_movements),
    'purchase_invoices', (SELECT count(*) FROM public.purchase_invoices),
    'journal_entries', (SELECT count(*) FROM public.journal_entries),
    'journal_entry_lines', (SELECT count(*) FROM public.journal_entry_lines),
    'repairs', (SELECT count(*) FROM public.inventory_reconciliation_repairs),
    'repair_items', (SELECT count(*) FROM public.inventory_reconciliation_repair_items),
    'repair_effects', (SELECT count(*) FROM public.inventory_reconciliation_repair_effects),
    'repair_events', (SELECT count(*) FROM public.inventory_reconciliation_repair_events)
  )
) AS verification;
ROLLBACK;
`;
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  const verification = runCli(sqlPath, logPath).rows?.[0]?.verification;
  const repair = verification?.repair;
  const item = verification?.item;
  const source = verification?.source;
  const journal = verification?.journal;
  const counts = verification?.counts;
  const events = verification?.events ?? {};
  const executed = mode === "--executed";
  if (!verification || verification.result !== "STAGING_2D_PURCHASE_ACCEPTANCE_VERIFIED"
      || verification.database !== "postgres" || !verification.server_version?.startsWith("17.")) {
    throw new Error(`هوية قاعدة Staging غير صحيحة؛ التشخيص المحمي: ${logPath}`);
  }
  if (repair?.repair_number !== 48 || repair?.status !== expected.status || repair?.version !== expected.version
      || item?.axis !== "source" || item?.classification !== "movement_without_journal"
      || item?.repair_type !== "create_missing_inventory_journal"
      || item?.source_type !== "purchase_invoice" || item?.source_id !== sourceId
      || item?.source_number !== String(invoiceNumber) || !item?.precondition_hash
      || source?.invoice_number !== invoiceNumber || source?.status !== "posted"
      || Number(source?.subtotal) !== 100 || Number(source?.tax) !== 0 || Number(source?.total) !== 100
      || Number(verification.product?.quantity_on_hand) !== 2
      || Number(verification.product?.purchase_price) !== 50) {
    throw new Error(`رأس أو بند قبول 2D لا يطابق العقد؛ التشخيص المحمي: ${logPath}`);
  }
  for (const [eventType, count] of Object.entries(expected.events)) {
    if (events[eventType] !== count) throw new Error(`حدث ${eventType} لا يطابق العقد؛ التشخيص المحمي: ${logPath}`);
  }
  if (Object.values(events).reduce((sum, value) => sum + Number(value), 0) !== expected.version) {
    throw new Error(`عدد أحداث المعالجة لا يطابق الإصدار؛ التشخيص المحمي: ${logPath}`);
  }
  if (counts.products !== baseline.products + 1
      || counts.inventory_movements !== baseline.inventoryMovements + 1
      || counts.purchase_invoices !== baseline.purchaseInvoices + 1
      || counts.repairs !== baseline.repairs + 1
      || counts.repair_items !== baseline.repairItems + 1
      || counts.repair_events !== baseline.repairEvents + expected.version) {
    throw new Error(`أعداد حالة القبول لا تطابق الزيادة المضبوطة؛ التشخيص المحمي: ${logPath}`);
  }
  const proposed = item.proposed_state ?? {};
  if (!executed) {
    if (verification.effects !== 0 || counts.repair_effects !== baseline.repairEffects
        || counts.journal_entries !== baseline.journalEntries
        || counts.journal_entry_lines !== baseline.journalEntryLines
        || source.journal_entry_id !== null || item.result_status !== "pending"
        || proposed.mode !== "create_full_journal" || !proposed.plan_fingerprint
        || verification.live_plan?.eligible !== true || verification.live_plan?.reason_code !== "READY"
        || verification.live_plan?.plan_fingerprint !== proposed.plan_fingerprint
        || JSON.stringify(comparableLines(verification.live_plan?.correction_lines))
          !== JSON.stringify(comparableLines(proposed.correction_lines))) {
      throw new Error(`الخطة المخزنة أو حالة ما قبل التنفيذ غير صحيحة؛ التشخيص المحمي: ${logPath}`);
    }
  } else if (verification.effects !== 1 || counts.repair_effects !== baseline.repairEffects + 1
      || counts.journal_entries !== baseline.journalEntries + 1
      || counts.journal_entry_lines !== baseline.journalEntryLines + 2
      || !source.journal_entry_id || item.result_status !== "applied"
      || verification.effect?.effect_type !== "missing_inventory_journal_created"
      || verification.effect?.table_name !== "journal_entries"
      || verification.effect?.record_id !== source.journal_entry_id
      || journal?.id !== source.journal_entry_id || journal?.status !== "posted"
      || Number(journal?.total_debit) !== 100 || Number(journal?.total_credit) !== 100
      || Number(journal?.line_count) !== 2
      || verification.live_plan?.eligible !== false
      || verification.live_plan?.reason_code !== "NO_CORRECTION_REQUIRED"
      || JSON.stringify(comparableLines(verification.live_plan?.actual_lines))
        !== JSON.stringify(comparableLines(proposed.correction_lines))
      || (verification.diagnostic_row !== null
        && (verification.diagnostic_row?.classification !== "matched"
          || Number(verification.diagnostic_row?.source_difference) !== 0))) {
    throw new Error(`أثر تنفيذ 2D أو التشخيص اللاحق غير صحيح؛ التشخيص المحمي: ${logPath}`);
  }
  writeFileSync(reportPath, `${JSON.stringify({
    ...verification,
    mode,
    verifiedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    readOnly: true,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log(`نجح تحقق حالة قبول 2D في مرحلة ${mode.slice(2)} دون كتابة على القاعدة`);
  console.log(`REPAIR=IR-${String(repair.repair_number).padStart(4, "0")} STATUS=${repair.status} VERSION=${repair.version}`);
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
