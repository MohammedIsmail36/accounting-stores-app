// Read-only verification for the first real inventory repair draft on Staging.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const baselinePath = "/tmp/staging-inventory-repair-before-20260914-081004/baseline.json";
const baselineManifestPath = "/tmp/staging-inventory-repair-before-20260914-081004/manifest.json";
const baselineArchive = "/backups/staging/inventory-repair-before-20260914-081004";
const cli = "supabase@2.116.0";

export function validateFirstDraftVerifierSource(source) {
  for (const required of [
    expectedProjectRef,
    baselineArchive,
    "BEGIN TRANSACTION READ ONLY;",
    "ROLLBACK;",
    "STAGING_INVENTORY_REPAIR_FIRST_DRAFT_OK",
    "repair_number = 1",
    "post_rounding_adjustment",
    "businessBaselinePreserved",
    "--after-create",
    "--after-edit",
    "--after-submit",
    "--after-approve",
  ]) {
    if (!source.includes(required)) throw new Error(`حاجز تحقق المسودة مفقود: ${required}`);
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

function runCli(filePath, logPath) {
  const result = spawnSync("npx", [
    "-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", filePath,
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  writeFileSync(logPath, output, { mode: 0o600 });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    throw new Error(`فشل تحقق أول مسودة؛ التشخيص المحمي: ${logPath}`);
  }
  return JSON.parse(result.stdout);
}

function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !["--after-create", "--after-edit", "--after-submit", "--after-approve"].includes(mode)) {
    throw new Error("استخدم --after-create أو --after-edit أو --after-submit أو --after-approve");
  }
  const afterEdit = mode === "--after-edit";
  const afterSubmit = mode === "--after-submit";
  const afterApprove = mode === "--after-approve";
  const expectedVersion = afterApprove ? 4 : afterSubmit ? 3 : afterEdit ? 2 : 1;
  const expectedEvents = afterApprove ? 4 : afterSubmit ? 3 : afterEdit ? 2 : 1;
  const expectedUpdatedEvents = afterEdit || afterSubmit || afterApprove ? 1 : 0;
  const expectedSubmittedEvents = afterSubmit || afterApprove ? 1 : 0;
  const expectedApprovedEvents = afterApprove ? 1 : 0;
  const expectedStatus = afterApprove ? "approved" : afterSubmit ? "ready_for_review" : "draft";
  validateFirstDraftVerifierSource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  const linkedRef = readFileSync(projectRefPath, "utf8").trim();
  if (linkedRef !== expectedProjectRef) {
    throw new Error(`رفض التنفيذ: المشروع المرتبط ${linkedRef || "غير موجود"} ليس Staging المعتمد`);
  }

  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const manifest = JSON.parse(readFileSync(baselineManifestPath, "utf8"));
  const baselineSha = createHash("sha256").update(readFileSync(baselinePath)).digest("hex");
  if (manifest.files?.["baseline.json"]?.sha256 !== baselineSha) {
    throw new Error("بصمة خط الأساس لا تطابق النسخة المحفوظة");
  }

  const reportDir = mkdtempSync(`/tmp/accounting-staging-inventory-repair-${afterApprove ? "approved" : afterSubmit ? "submitted" : afterEdit ? "edited" : "first"}-draft-`);
  const sqlPath = join(reportDir, "verification.sql");
  const logPath = join(reportDir, "run.log");
  const reportPath = join(reportDir, "report.json");
  const sql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT jsonb_build_object(
  'result', 'STAGING_INVENTORY_REPAIR_FIRST_DRAFT_OK',
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'repair_counts', jsonb_build_object(
    'repairs', (SELECT count(*) FROM public.inventory_reconciliation_repairs),
    'items', (SELECT count(*) FROM public.inventory_reconciliation_repair_items),
    'events', (SELECT count(*) FROM public.inventory_reconciliation_repair_events),
    'effects', (SELECT count(*) FROM public.inventory_reconciliation_repair_effects)
  ),
  'first_repair', (
    SELECT jsonb_build_object(
      'repair_number', r.repair_number,
      'status', r.status,
      'version', r.version,
      'item_count', (SELECT count(*) FROM public.inventory_reconciliation_repair_items i WHERE i.repair_id = r.id),
      'created_events', (SELECT count(*) FROM public.inventory_reconciliation_repair_events e WHERE e.repair_id = r.id AND e.event_type = 'created'),
      'updated_events', (SELECT count(*) FROM public.inventory_reconciliation_repair_events e WHERE e.repair_id = r.id AND e.event_type = 'updated'),
      'submitted_events', (SELECT count(*) FROM public.inventory_reconciliation_repair_events e WHERE e.repair_id = r.id AND e.event_type = 'submitted'),
      'approved_events', (SELECT count(*) FROM public.inventory_reconciliation_repair_events e WHERE e.repair_id = r.id AND e.event_type = 'approved'),
      'prepared_by', r.prepared_by,
      'submitted_at', r.submitted_at,
      'approved_by', r.approved_by,
      'approved_at', r.approved_at,
      'separation_override_reason', r.separation_override_reason,
      'purchase_invoice_business_changes_since_submission', (
        SELECT count(*) FROM public.audit_log a
        WHERE a.table_name = 'purchase_invoices'
          AND a.created_at > r.submitted_at
          AND (COALESCE(a.old_data, '{}'::jsonb) - 'updated_at')
            IS DISTINCT FROM (COALESCE(a.new_data, '{}'::jsonb) - 'updated_at')
      ),
      'purchase_invoice_metadata_updates_since_submission', (
        SELECT count(*) FROM public.audit_log a
        WHERE a.table_name = 'purchase_invoices'
          AND a.created_at > r.submitted_at
          AND (COALESCE(a.old_data, '{}'::jsonb) - 'updated_at')
            IS NOT DISTINCT FROM (COALESCE(a.new_data, '{}'::jsonb) - 'updated_at')
          AND a.old_data->'updated_at' IS DISTINCT FROM a.new_data->'updated_at'
      ),
      'purchase_invoice_first_metadata_update_at', (
        SELECT min(a.created_at) FROM public.audit_log a
        WHERE a.table_name = 'purchase_invoices'
          AND a.created_at > r.submitted_at
          AND (COALESCE(a.old_data, '{}'::jsonb) - 'updated_at')
            IS NOT DISTINCT FROM (COALESCE(a.new_data, '{}'::jsonb) - 'updated_at')
          AND a.old_data->'updated_at' IS DISTINCT FROM a.new_data->'updated_at'
      ),
      'effects', (SELECT count(*) FROM public.inventory_reconciliation_repair_effects x WHERE x.repair_id = r.id),
      'item', (SELECT jsonb_build_object(
        'axis', i.axis,
        'classification', i.classification,
        'repair_type', i.repair_type,
        'source_type', i.source_type,
        'source_number', i.source_number,
        'result_status', i.result_status
      ) FROM public.inventory_reconciliation_repair_items i WHERE i.repair_id = r.id ORDER BY i.line_number LIMIT 1)
    )
    FROM public.inventory_reconciliation_repairs r
    WHERE r.repair_number = 1
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
) AS verification;
ROLLBACK;
`;
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  const response = runCli(sqlPath, logPath);
  const verification = response.rows?.[0]?.verification;
  const repair = verification?.first_repair;
  const item = repair?.item;
  if (!verification || verification.result !== "STAGING_INVENTORY_REPAIR_FIRST_DRAFT_OK"
      || verification.database !== "postgres" || verification.server_version !== "17.6") {
    throw new Error(`فشل تحقق هوية Staging؛ التشخيص المحمي: ${logPath}`);
  }
  if (verification.repair_counts?.repairs !== 1 || verification.repair_counts?.items !== 1
      || verification.repair_counts?.events !== expectedEvents || verification.repair_counts?.effects !== 0
      || repair?.repair_number !== 1 || repair?.status !== expectedStatus || repair?.version !== expectedVersion
      || repair?.item_count !== 1 || repair?.created_events !== 1
      || repair?.updated_events !== expectedUpdatedEvents || repair?.submitted_events !== expectedSubmittedEvents
      || repair?.approved_events !== expectedApprovedEvents
      || repair?.effects !== 0
      || item?.axis !== "source" || item?.classification !== "rounding"
      || item?.repair_type !== "post_rounding_adjustment" || item?.source_type !== "purchase_invoice"
      || item?.source_number !== "24" || item?.result_status !== "pending") {
    throw new Error(`دورة أول مسودة أو بندها لا تطابق العقد؛ التشخيص المحمي: ${logPath}`);
  }
  if (afterApprove && (!repair.approved_by || !repair.approved_at
      || (repair.prepared_by === repair.approved_by && !repair.separation_override_reason?.trim()))) {
    throw new Error(`بيانات اعتماد المعالجة أو توثيق عدم فصل المهام غير مكتملة؛ التشخيص المحمي: ${logPath}`);
  }
  const countsPreserved = JSON.stringify(verification.counts) === JSON.stringify(baseline.counts);
  const signatureDiffs = Object.keys(verification.signatures)
    .filter((key) => verification.signatures[key] !== baseline.signatures[key]);
  const rawBusinessSignaturesPreserved = signatureDiffs.length === 0;
  const metadataOnlyPurchaseChange = afterApprove
    && signatureDiffs.length === 1
    && signatureDiffs[0] === "purchase_invoices"
    && repair.purchase_invoice_business_changes_since_submission === 0
    && repair.purchase_invoice_metadata_updates_since_submission > 0
    && Date.parse(repair.purchase_invoice_first_metadata_update_at) > Date.parse(repair.approved_at);
  const diagnosticPreserved = verification.diagnostic.fingerprint === baseline.diagnostic.fingerprint
    && verification.diagnostic.status === baseline.diagnostic.status;
  if (!countsPreserved || (!rawBusinessSignaturesPreserved && !metadataOnlyPurchaseChange)
      || !diagnosticPreserved) {
    throw new Error(`تغيرت بيانات الأعمال أو التشخيص عن خط الأساس؛ التشخيص المحمي: ${logPath}`);
  }

  const report = {
    result: verification.result,
    verifiedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    baselineArchive,
    state: mode,
    repair: repair,
    repairRegistryOnly: true,
    businessBaselinePreserved: true,
    rawBusinessSignaturesPreserved,
    acceptedMetadataOnlySignatureDiffs: metadataOnlyPurchaseChange ? signatureDiffs : [],
    diagnosticPreserved,
    productionModified: false,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`نجح تحقق ${afterApprove ? "اعتماد" : afterSubmit ? "إرسال" : afterEdit ? "تعديل" : "إنشاء"} المسودة على Staging`);
  console.log(`IR-0001: إصدار ${expectedVersion}، بند واحد، ${expectedEvents} حدث، وصفر آثار تنفيذ`);
  if (metadataOnlyPurchaseChange) {
    console.log("تغير توقيت تحديث فاتورة الشراء فقط في معاملة منفصلة بعد الاعتماد؛ المحتوى المالي لم يتغير");
  }
  console.log("بيانات الأعمال والتشخيص مطابقان لخط الأساس؛ لم يحدث إصلاح أو ترحيل");
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
