// Read-only verifier for controlled stage-2D acceptance lifecycles on Staging.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const cli = "supabase@2.116.0";

const profiles = {
  "--purchase": {
    slug: "purchase",
    result: "STAGING_2D_PURCHASE_ACCEPTANCE_VERIFIED",
    sourceType: "purchase_invoice",
    sourceTable: "purchase_invoices",
    sourceId: "2d2d0000-0000-4000-8000-000000000102",
    productId: "2d2d0000-0000-4000-8000-000000000101",
    invoiceNumber: 990021,
    repairNumber: 48,
    productQuantity: 2,
    productCost: 50,
    journalTotal: 100,
    journalLineCount: 2,
    journalPostedNumber: 312,
    openingMovementId: null,
    openingPostedNumber: null,
    baseline: {
      products: 613, inventoryMovements: 1364, purchaseInvoices: 31, salesInvoices: 98,
      journalEntries: 311, journalEntryLines: 831, repairs: 3, repairItems: 3,
      repairEffects: 1, repairEvents: 12,
    },
    fixture: {
      products: 1, inventoryMovements: 1, purchaseInvoices: 1, salesInvoices: 0,
      journalEntries: 0, journalEntryLines: 0,
    },
  },
  "--sales": {
    slug: "sales",
    result: "STAGING_2D_SALES_ACCEPTANCE_VERIFIED",
    sourceType: "sales_invoice",
    sourceTable: "sales_invoices",
    sourceId: "2d2d0000-0000-4000-8000-000000000202",
    productId: "2d2d0000-0000-4000-8000-000000000201",
    invoiceNumber: 990022,
    repairNumber: 49,
    productQuantity: 8,
    productCost: 40,
    journalTotal: 180,
    journalLineCount: 4,
    journalPostedNumber: 314,
    openingMovementId: "2d2d0000-0000-4000-8000-000000000205",
    openingPostedNumber: 313,
    baseline: {
      products: 614, inventoryMovements: 1365, purchaseInvoices: 32, salesInvoices: 98,
      journalEntries: 312, journalEntryLines: 833, repairs: 4, repairItems: 4,
      repairEffects: 2, repairEvents: 16,
    },
    fixture: {
      products: 1, inventoryMovements: 2, purchaseInvoices: 0, salesInvoices: 1,
      journalEntries: 1, journalEntryLines: 2,
    },
  },
};

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") {
      throw new Error("شغّل الفاحص بواسطة sudo من حساب deploy فقط");
    }
    const accessToken = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
    if (!accessToken) throw new Error("جلسة Supabase للمستخدم deploy غير موجودة");
    return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: accessToken };
  }
  return process.env;
}

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
    env: cliEnvironment(),
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

function extractNamedPayload(value, name) {
  if (!value || typeof value !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(value, name)) return value[name];
  for (const child of Object.values(value)) {
    const found = extractNamedPayload(child, name);
    if (found !== undefined) return found;
  }
  return undefined;
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

function lineTotals(lines) {
  return (lines ?? []).reduce((totals, line) => ({
    debit: totals.debit + Number(line.debit),
    credit: totals.credit + Number(line.credit),
  }), { debit: 0, credit: 0 });
}

function expectedCount(profile, key, executed, version) {
  const base = profile.baseline[key];
  const fixture = profile.fixture[key] ?? 0;
  if (key === "repairs" || key === "repairItems") return base + 1;
  if (key === "repairEvents") return base + version;
  if (key === "repairEffects") return base + (executed ? 1 : 0);
  if (key === "journalEntries") return base + fixture + (executed ? 1 : 0);
  if (key === "journalEntryLines") return base + fixture + (executed ? profile.journalLineCount : 0);
  return base + fixture;
}

function main() {
  const mode = process.argv[2];
  const profileFlag = process.argv[3] ?? "--purchase";
  if (!phases[mode] || !profiles[profileFlag] || process.argv.length > 4) {
    throw new Error("استخدم مرحلة --draft أو --submitted أو --approved أو --executed، ثم --purchase أو --sales");
  }
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }
  const expected = phases[mode];
  const profile = profiles[profileFlag];
  const reportDir = mkdtempSync(`/tmp/accounting-staging-2d-${profile.slug}-${mode.slice(2)}-verification-`);
  const sqlPath = join(reportDir, "verification.sql");
  const logPath = join(reportDir, "run.log");
  const reportPath = join(reportDir, "report.json");
  const openingSql = profile.openingMovementId
    ? `(SELECT jsonb_build_object(
      'movement_type', m.movement_type, 'quantity', m.quantity, 'total_cost', m.total_cost,
      'reference_type', m.reference_type, 'journal_id', j.id, 'journal_status', j.status,
      'journal_posted_number', j.posted_number,
      'journal_debit', j.total_debit, 'journal_credit', j.total_credit,
      'line_count', (SELECT count(*) FROM public.journal_entry_lines l WHERE l.journal_entry_id = j.id)
    ) FROM public.inventory_movements m
      JOIN public.journal_entries j ON j.id = m.reference_id
      WHERE m.id = '${profile.openingMovementId}'::uuid)`
    : "NULL::jsonb";
  const sql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
WITH target AS (
  SELECT r.*
  FROM public.inventory_reconciliation_repairs r
  JOIN public.inventory_reconciliation_repair_items i ON i.repair_id = r.id
  WHERE i.source_type = '${profile.sourceType}' AND i.source_id = '${profile.sourceId}'::uuid
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
    'sources', true, '${profile.sourceId}', 500, 0, NULL
  )->'rows')
  WHERE value->>'source_type' = '${profile.sourceType}'
    AND value->>'source_id' = '${profile.sourceId}' LIMIT 1
)
SELECT jsonb_build_object(
  'result', '${profile.result}',
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'configured_prefix', (
    SELECT journal_entry_prefix FROM public.company_settings ORDER BY created_at ASC LIMIT 1
  ),
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
  'source', (SELECT jsonb_build_object('invoice_number', s.invoice_number, 'status', s.status,
    'subtotal', s.subtotal, 'tax', s.tax, 'total', s.total, 'journal_entry_id', s.journal_entry_id)
    FROM public.${profile.sourceTable} s WHERE s.id = '${profile.sourceId}'::uuid),
  'journal', (SELECT jsonb_build_object(
    'id', j.id, 'status', j.status, 'entry_type', j.entry_type,
    'posted_number', j.posted_number,
    'total_debit', j.total_debit, 'total_credit', j.total_credit,
    'line_count', (SELECT count(*) FROM public.journal_entry_lines l WHERE l.journal_entry_id = j.id)
  ) FROM public.journal_entries j
    WHERE j.id = (SELECT s.journal_entry_id FROM public.${profile.sourceTable} s WHERE s.id = '${profile.sourceId}'::uuid)),
  'opening', ${openingSql},
  'product', (SELECT jsonb_build_object('quantity_on_hand', p.quantity_on_hand,
    'purchase_price', p.purchase_price) FROM public.products p WHERE p.id = '${profile.productId}'::uuid),
  'diagnostic_row', (SELECT row FROM source_row),
  'live_plan', public.get_inventory_reconciliation_journal_plan(
    '${profile.sourceType}', '${profile.sourceId}'::uuid,
    (SELECT accounting_date FROM target LIMIT 1)
  ),
  'counts', jsonb_build_object(
    'products', (SELECT count(*) FROM public.products),
    'inventoryMovements', (SELECT count(*) FROM public.inventory_movements),
    'purchaseInvoices', (SELECT count(*) FROM public.purchase_invoices),
    'salesInvoices', (SELECT count(*) FROM public.sales_invoices),
    'journalEntries', (SELECT count(*) FROM public.journal_entries),
    'journalEntryLines', (SELECT count(*) FROM public.journal_entry_lines),
    'repairs', (SELECT count(*) FROM public.inventory_reconciliation_repairs),
    'repairItems', (SELECT count(*) FROM public.inventory_reconciliation_repair_items),
    'repairEffects', (SELECT count(*) FROM public.inventory_reconciliation_repair_effects),
    'repairEvents', (SELECT count(*) FROM public.inventory_reconciliation_repair_events)
  )
) AS verification;
ROLLBACK;
`;
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  const verification = extractNamedPayload(runCli(sqlPath, logPath), "verification");
  const repair = verification?.repair;
  const item = verification?.item;
  const source = verification?.source;
  const journal = verification?.journal;
  const counts = verification?.counts;
  const events = verification?.events ?? {};
  const executed = mode === "--executed";
  if (!verification || verification.result !== profile.result
      || verification.database !== "postgres" || !verification.server_version?.startsWith("17.")
      || typeof verification.configured_prefix !== "string"
      || verification.configured_prefix.trim() === "") {
    throw new Error(`هوية قاعدة Staging غير صحيحة؛ التشخيص المحمي: ${logPath}`);
  }
  if (repair?.repair_number !== profile.repairNumber || repair?.status !== expected.status || repair?.version !== expected.version
      || item?.axis !== "source" || item?.classification !== "movement_without_journal"
      || item?.repair_type !== "create_missing_inventory_journal"
      || item?.source_type !== profile.sourceType || item?.source_id !== profile.sourceId
      || item?.source_number !== String(profile.invoiceNumber) || !item?.precondition_hash
      || source?.invoice_number !== profile.invoiceNumber || source?.status !== "posted"
      || Number(source?.subtotal) !== 100 || Number(source?.tax) !== 0 || Number(source?.total) !== 100
      || Number(verification.product?.quantity_on_hand) !== profile.productQuantity
      || Number(verification.product?.purchase_price) !== profile.productCost) {
    throw new Error(`رأس أو بند قبول 2D لا يطابق العقد؛ التشخيص المحمي: ${logPath}`);
  }
  if (profile.openingMovementId && (verification.opening?.movement_type !== "opening_balance"
      || verification.opening?.reference_type !== "staging_seed"
      || Number(verification.opening?.quantity) !== 10 || Number(verification.opening?.total_cost) !== 400
      || verification.opening?.journal_status !== "posted"
      || verification.opening?.journal_posted_number !== profile.openingPostedNumber
      || Number(verification.opening?.journal_debit) !== 400
      || Number(verification.opening?.journal_credit) !== 400
      || Number(verification.opening?.line_count) !== 2)) {
    throw new Error(`الرصيد الافتتاحي لحالة البيع غير متزن؛ التشخيص المحمي: ${logPath}`);
  }
  for (const [eventType, count] of Object.entries(expected.events)) {
    if (events[eventType] !== count) throw new Error(`حدث ${eventType} لا يطابق العقد؛ التشخيص المحمي: ${logPath}`);
  }
  if (Object.values(events).reduce((sum, value) => sum + Number(value), 0) !== expected.version) {
    throw new Error(`عدد أحداث المعالجة لا يطابق الإصدار؛ التشخيص المحمي: ${logPath}`);
  }
  for (const key of Object.keys(profile.baseline)) {
    if (counts[key] !== expectedCount(profile, key, executed, expected.version)) {
      throw new Error(`عدد ${key} لا يطابق الزيادة المضبوطة؛ التشخيص المحمي: ${logPath}`);
    }
  }
  const proposed = item.proposed_state ?? {};
  const proposedTotals = lineTotals(proposed.correction_lines);
  if (!executed) {
    if (verification.effects !== 0 || source.journal_entry_id !== null || item.result_status !== "pending"
        || proposed.mode !== "create_full_journal" || !proposed.plan_fingerprint
        || proposedTotals.debit !== profile.journalTotal || proposedTotals.credit !== profile.journalTotal
        || comparableLines(proposed.correction_lines).length !== profile.journalLineCount
        || verification.live_plan?.eligible !== true || verification.live_plan?.reason_code !== "READY"
        || verification.live_plan?.plan_fingerprint !== proposed.plan_fingerprint
        || JSON.stringify(comparableLines(verification.live_plan?.correction_lines))
          !== JSON.stringify(comparableLines(proposed.correction_lines))) {
      throw new Error(`الخطة المخزنة أو حالة ما قبل التنفيذ غير صحيحة؛ التشخيص المحمي: ${logPath}`);
    }
  } else if (verification.effects !== 1 || !source.journal_entry_id || item.result_status !== "applied"
      || verification.effect?.effect_type !== "missing_inventory_journal_created"
      || verification.effect?.table_name !== "journal_entries"
      || verification.effect?.record_id !== source.journal_entry_id
      || journal?.id !== source.journal_entry_id || journal?.status !== "posted"
      || journal?.posted_number !== profile.journalPostedNumber
      || Number(journal?.total_debit) !== profile.journalTotal
      || Number(journal?.total_credit) !== profile.journalTotal
      || Number(journal?.line_count) !== profile.journalLineCount
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
    profile: profile.slug,
    officialJournalNumber: executed
      ? `${verification.configured_prefix}${String(journal.posted_number).padStart(4, "0")}`
      : null,
    verifiedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    readOnly: true,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log(`نجح تحقق حالة قبول 2D (${profile.slug}) في مرحلة ${mode.slice(2)} دون كتابة على القاعدة`);
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
