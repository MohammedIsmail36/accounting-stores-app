// Read-only verifier for the taxed-purchase repair lifecycle on Staging.
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptanceFixture as fixture, extractNamedPayload } from "./backup-inventory-tax-purchase-acceptance-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const cli = "supabase@2.116.0";
const baseCounts = Object.freeze({
  products: 616,
  inventory_movements: 1368,
  purchase_invoices: 33,
  journal_entries: 314,
  journal_entry_lines: 839,
  repairs: 5,
  repair_items: 5,
  repair_effects: 3,
  repair_events: 20,
});
const phases = Object.freeze({
  "--draft": { status: "draft", version: 1, events: { created: 1 } },
  "--submitted": { status: "ready_for_review", version: 2, events: { created: 1, submitted: 1 } },
  "--approved": { status: "approved", version: 3, events: { created: 1, submitted: 1, approved: 1 } },
  "--executed": { status: "executed", version: 4, events: { created: 1, submitted: 1, approved: 1, executed: 1 } },
});

function assertStagingLink() {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التحقق: المشروع المرتبط ليس Staging المعتمد");
  }
}

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") throw new Error("شغّل التحقق بواسطة sudo من حساب deploy فقط");
    const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
    if (!token) throw new Error("جلسة Supabase للمستخدم deploy غير موجودة");
    return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: token };
  }
  return process.env;
}

function runCli(sqlPath, logPath) {
  assertStagingLink();
  const result = spawnSync("npx", [
    "-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", sqlPath,
  ], {
    cwd: root,
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}`, { mode: 0o600 });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    throw new Error(`فشل تحقق قبول الشراء الضريبي؛ التشخيص: ${logPath}`);
  }
  return JSON.parse(result.stdout);
}

function comparableLines(lines) {
  return [...(lines ?? [])].map((line) => ({
    account_code: String(line.account_code),
    debit: Number(line.debit),
    credit: Number(line.credit),
  })).sort((a, b) => a.account_code.localeCompare(b.account_code));
}

function expectedLines() {
  return comparableLines([
    { account_code: "1104", debit: 100, credit: 0 },
    { account_code: "1105", debit: 14, credit: 0 },
    { account_code: "2101", debit: 0, credit: 114 },
  ]);
}

export function validateVerification(verification, phase) {
  const expected = phases[phase];
  if (!expected) throw new Error("مرحلة تحقق غير مدعومة");
  const failures = [];
  const repair = verification?.repair;
  const item = verification?.item;
  const source = verification?.source;
  const events = verification?.events ?? {};
  const counts = verification?.counts ?? {};
  const proposed = comparableLines(item?.proposed_state?.correction_lines);
  const live = comparableLines(verification?.live_plan?.correction_lines);
  const executed = phase === "--executed";

  if (verification?.database !== "postgres" || !verification?.server_version?.startsWith("17.")) failures.push("database_identity");
  if (verification?.tax_settings?.enable_tax !== true || Number(verification?.tax_settings?.tax_rate) !== 14
      || verification?.tax_settings?.purchase_code !== "1105" || verification?.tax_settings?.sales_code !== "2104") failures.push("tax_settings");
  if (repair?.repair_number !== 50 || repair?.status !== expected.status || repair?.version !== expected.version) failures.push("repair_header");
  if (item?.axis !== "source" || item?.classification !== "movement_without_journal"
      || item?.repair_type !== "create_missing_inventory_journal"
      || item?.source_type !== "purchase_invoice" || item?.source_id !== fixture.invoiceId
      || item?.source_number !== String(fixture.invoiceNumber) || !item?.precondition_hash) failures.push("repair_item");
  if (source?.invoice_number !== fixture.invoiceNumber || source?.status !== "posted"
      || Number(source?.subtotal) !== 100 || Number(source?.tax) !== 14 || Number(source?.total) !== 114) failures.push("source");
  if (JSON.stringify(proposed) !== JSON.stringify(expectedLines())
      || item?.proposed_state?.mode !== "create_full_journal"
      || !item?.proposed_state?.plan_fingerprint) failures.push("stored_plan");
  for (const [event, count] of Object.entries(expected.events)) {
    if (Number(events[event]) !== count) failures.push(`event_${event}`);
  }
  if (Object.values(events).reduce((sum, count) => sum + Number(count), 0) !== expected.version) failures.push("event_total");
  if (Number(counts.products) !== baseCounts.products
      || Number(counts.inventory_movements) !== baseCounts.inventory_movements
      || Number(counts.purchase_invoices) !== baseCounts.purchase_invoices
      || Number(counts.repairs) !== baseCounts.repairs + 1
      || Number(counts.repair_items) !== baseCounts.repair_items + 1
      || Number(counts.repair_events) !== baseCounts.repair_events + expected.version
      || Number(counts.repair_effects) !== baseCounts.repair_effects + (executed ? 1 : 0)
      || Number(counts.journal_entries) !== baseCounts.journal_entries + (executed ? 1 : 0)
      || Number(counts.journal_entry_lines) !== baseCounts.journal_entry_lines + (executed ? 3 : 0)) failures.push("controlled_counts");

  if (!executed) {
    if (source?.journal_entry_id !== null || item?.result_status !== "pending"
        || Number(verification?.effect_count) !== 0
        || verification?.live_plan?.eligible !== true || verification?.live_plan?.reason_code !== "READY"
        || verification?.live_plan?.plan_fingerprint !== item?.proposed_state?.plan_fingerprint
        || JSON.stringify(live) !== JSON.stringify(expectedLines())) failures.push("pre_execution_state");
  } else {
    const journal = verification?.journal;
    if (!source?.journal_entry_id || item?.result_status !== "applied" || Number(verification?.effect_count) !== 1
        || verification?.effect?.effect_type !== "missing_inventory_journal_created"
        || verification?.effect?.table_name !== "journal_entries"
        || verification?.effect?.record_id !== source?.journal_entry_id
        || journal?.status !== "posted" || !Number.isInteger(journal?.posted_number)
        || Number(journal?.total_debit) !== 114 || Number(journal?.total_credit) !== 114
        || Number(journal?.line_count) !== 3
        || JSON.stringify(comparableLines(journal?.lines)) !== JSON.stringify(expectedLines())
        || verification?.live_plan?.eligible !== false || verification?.live_plan?.reason_code !== "NO_CORRECTION_REQUIRED") failures.push("execution_state");
  }
  if (failures.length > 0) throw new Error(`تحقق قبول الشراء الضريبي غير صحيح: ${failures.join(",")}`);
  return verification;
}

export function verificationSql() {
  return `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
WITH target AS (
  SELECT r.* FROM public.inventory_reconciliation_repairs r
  JOIN public.inventory_reconciliation_repair_items i ON i.repair_id = r.id
  WHERE i.source_type = 'purchase_invoice' AND i.source_id = '${fixture.invoiceId}'::uuid
), target_item AS (
  SELECT i.* FROM public.inventory_reconciliation_repair_items i JOIN target r ON r.id = i.repair_id
), event_counts AS (
  SELECT e.event_type, count(*)::integer AS count
  FROM public.inventory_reconciliation_repair_events e JOIN target r ON r.id = e.repair_id
  GROUP BY e.event_type
)
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'configured_prefix', (SELECT journal_entry_prefix FROM public.company_settings ORDER BY created_at LIMIT 1),
  'tax_settings', (SELECT jsonb_build_object(
    'enable_tax', s.enable_tax, 'tax_rate', s.tax_rate, 'purchase_code', p.code, 'sales_code', v.code
  ) FROM public.company_settings s
    JOIN public.accounts p ON p.id = s.purchase_tax_account_id
    JOIN public.accounts v ON v.id = s.sales_tax_account_id
    ORDER BY s.created_at LIMIT 1),
  'repair', (SELECT jsonb_build_object(
    'id', r.id, 'repair_number', r.repair_number, 'status', r.status, 'version', r.version,
    'prepared_by', r.prepared_by, 'submitted_by', r.submitted_by,
    'approved_by', r.approved_by, 'executed_by', r.executed_by
  ) FROM target r),
  'item', (SELECT jsonb_build_object(
    'id', i.id, 'axis', i.axis, 'classification', i.classification,
    'repair_type', i.repair_type, 'source_type', i.source_type, 'source_id', i.source_id,
    'source_number', i.source_number, 'result_status', i.result_status,
    'precondition_hash', i.precondition_hash, 'proposed_state', i.proposed_state
  ) FROM target_item i),
  'events', COALESCE((SELECT jsonb_object_agg(event_type, count) FROM event_counts), '{}'::jsonb),
  'effect_count', (SELECT count(*) FROM public.inventory_reconciliation_repair_effects e JOIN target r ON r.id = e.repair_id),
  'effect', (SELECT jsonb_build_object(
    'effect_type', e.effect_type, 'table_name', e.table_name, 'record_id', e.record_id
  ) FROM public.inventory_reconciliation_repair_effects e JOIN target r ON r.id = e.repair_id
    ORDER BY e.created_at DESC LIMIT 1),
  'source', (SELECT jsonb_build_object(
    'invoice_number', s.invoice_number, 'status', s.status, 'subtotal', s.subtotal,
    'tax', s.tax, 'total', s.total, 'journal_entry_id', s.journal_entry_id
  ) FROM public.purchase_invoices s WHERE s.id = '${fixture.invoiceId}'::uuid),
  'journal', (SELECT jsonb_build_object(
    'id', j.id, 'status', j.status, 'posted_number', j.posted_number,
    'total_debit', j.total_debit, 'total_credit', j.total_credit,
    'line_count', (SELECT count(*) FROM public.journal_entry_lines l WHERE l.journal_entry_id = j.id),
    'lines', (SELECT jsonb_agg(jsonb_build_object(
      'account_code', a.code, 'debit', l.debit, 'credit', l.credit
    ) ORDER BY a.code) FROM public.journal_entry_lines l JOIN public.accounts a ON a.id = l.account_id
      WHERE l.journal_entry_id = j.id)
  ) FROM public.journal_entries j
    WHERE j.id = (SELECT s.journal_entry_id FROM public.purchase_invoices s WHERE s.id = '${fixture.invoiceId}'::uuid)),
  'live_plan', public.get_inventory_reconciliation_journal_plan(
    'purchase_invoice', '${fixture.invoiceId}'::uuid, (SELECT accounting_date FROM target LIMIT 1)
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
) AS tax_purchase_verification;
ROLLBACK;
`;
}

function main() {
  const phase = process.argv[2];
  if (!phases[phase] || process.argv.length !== 3) {
    throw new Error("استخدم --draft أو --submitted أو --approved أو --executed");
  }
  assertStagingLink();
  process.umask(0o077);
  const reportDir = mkdtempSync(`/tmp/accounting-staging-tax-purchase-${phase.slice(2)}-verification-`);
  chmodSync(reportDir, 0o700);
  const sqlPath = join(reportDir, "verification.sql");
  const logPath = join(reportDir, "run.log");
  const reportPath = join(reportDir, "report.json");
  writeFileSync(sqlPath, verificationSql(), { mode: 0o600 });
  const verification = validateVerification(
    extractNamedPayload(runCli(sqlPath, logPath), "tax_purchase_verification"), phase,
  );
  const journalNumber = phase === "--executed"
    ? `${verification.configured_prefix}${String(verification.journal.posted_number).padStart(4, "0")}`
    : null;
  writeFileSync(reportPath, `${JSON.stringify({
    ...verification,
    phase,
    officialJournalNumber: journalNumber,
    projectRef: expectedProjectRef,
    readOnly: true,
    productionModified: false,
    verifiedAt: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 });
  console.log(`نجح تحقق قبول فاتورة الشراء الضريبية في مرحلة ${phase.slice(2)} دون كتابة على القاعدة`);
  console.log(`REPAIR=IR-${String(verification.repair.repair_number).padStart(4, "0")} STATUS=${verification.repair.status} VERSION=${verification.repair.version}`);
  if (journalNumber) console.log(`JOURNAL=${journalNumber}`);
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
