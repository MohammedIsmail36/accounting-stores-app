// Controlled Staging-only fixture for proving that an approved stale repair is rejected.
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRefPath = join(root, "supabase/.temp/project-ref");
const baselineDir = "/tmp/staging-inventory-stale-guard-before-PNnzfw";
const expectedProjectRef = "dunzfxurefzlaamgghys";
const productId = "2e364454-c894-48f4-bb47-1389ee723336";
const cli = "supabase@2.116.0";

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertStagingLink() {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }
}

function loadBaseline() {
  const manifest = JSON.parse(readFileSync(join(baselineDir, "manifest.json"), "utf8"));
  if (manifest.result !== "STAGING_INVENTORY_STALE_GUARD_BASELINE_OK"
      || manifest.projectRef !== expectedProjectRef) {
    throw new Error("ملف بيان النسخة لا يخص Staging المعتمد");
  }
  for (const [name, detail] of Object.entries(manifest.files)) {
    if (hash(join(baselineDir, name)) !== detail.sha256) {
      throw new Error(`بصمة ملف النسخة غير صحيحة: ${name}`);
    }
  }
  const baseline = JSON.parse(readFileSync(join(baselineDir, "baseline.json"), "utf8"));
  if (baseline.project_ref !== expectedProjectRef || baseline.database !== "postgres"
      || baseline.server_version !== "17.6" || !baseline.executor_recorded
      || !baseline.executor_enabled || baseline.target?.id !== productId
      || baseline.target?.quantity_on_hand !== 1
      || baseline.target_movements?.count !== 2
      || baseline.target_movements?.quantity !== 1
      || baseline.target_movements?.book_value !== 130
      || baseline.target_diagnostic?.classification !== "matched"
      || baseline.active_target_repairs !== 0) {
    throw new Error("خط أساس المنتج لا يطابق حالة الاختبار المعتمدة");
  }
  return baseline;
}

const diagnosticRow = `(SELECT value FROM jsonb_array_elements(
  public.get_inventory_reconciliation_diagnostic('products', false, 'PRD-002', 500, 0, NULL)->'rows'
) WHERE value->>'product_id' = '${productId}' LIMIT 1)`;

const signatureTables = {
  products: "products",
  inventory_movements: "inventory_movements",
  sales_invoices: "sales_invoices",
  purchase_invoices: "purchase_invoices",
  journal_entries: "journal_entries",
  journal_entry_lines: "journal_entry_lines",
  repairs: "inventory_reconciliation_repairs",
  repair_items: "inventory_reconciliation_repair_items",
  repair_effects: "inventory_reconciliation_repair_effects",
  repair_events: "inventory_reconciliation_repair_events",
};

function baselineGuard(baseline) {
  const checks = Object.entries(signatureTables).map(([key, table]) => {
    const digest = baseline.signatures?.[key];
    const count = baseline.counts?.[key];
    if (!/^[0-9a-f]{32}$/.test(digest) || !Number.isSafeInteger(count)) {
      throw new Error(`خط أساس ${key} غير صالح`);
    }
    return `(SELECT count(*) FROM public.${table}) <> ${count}
      OR (SELECT md5(COALESCE(string_agg(to_jsonb(t)::text, '|' ORDER BY t.id), ''))
          FROM public.${table} t) IS DISTINCT FROM '${digest}'`;
  });
  return `DO $guard$
DECLARE v_row jsonb;
BEGIN
  IF current_database() <> 'postgres'
     OR current_setting('server_version') <> '17.6'
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
       WHERE version = '20260914190000')
     OR position('product_card_rebuilt' IN pg_get_functiondef(
       'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
     )) = 0
     OR ${checks.join("\n     OR ")} THEN
    RAISE EXCEPTION 'STAGING_STALE_BASELINE_CHANGED';
  END IF;
  v_row := ${diagnosticRow};
  IF v_row IS NULL OR v_row->>'classification' <> 'matched'
     OR (v_row->>'card_quantity')::numeric <> 1
     OR (v_row->>'movement_quantity')::numeric <> 1
     OR (v_row->>'movement_book_value')::numeric <> 130
     OR (v_row->>'movement_count')::integer <> 2
     OR (SELECT status FROM public.inventory_reconciliation_repairs
       WHERE repair_number = 12) <> 'executed'
     OR EXISTS (
       SELECT 1 FROM public.inventory_reconciliation_repair_items i
       JOIN public.inventory_reconciliation_repairs r ON r.id = i.repair_id
       WHERE i.product_id = '${productId}'::uuid
         AND r.status IN ('draft', 'ready_for_review', 'approved')
     ) THEN
    RAISE EXCEPTION 'STAGING_STALE_TARGET_CHANGED';
  END IF;
END;
$guard$;`;
}

function setupSql(baseline, commit) {
  return `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_advisory_xact_lock(hashtextextended('inventory-repair:product:${productId}', 0));
${baselineGuard(baseline)}
UPDATE public.products SET quantity_on_hand = 2
WHERE id = '${productId}'::uuid AND code = 'PRD-002' AND quantity_on_hand = 1;
DO $postcheck$
DECLARE v_row jsonb;
BEGIN
  v_row := ${diagnosticRow};
  IF v_row IS NULL OR v_row->>'classification' <> 'product_balance'
     OR (v_row->>'card_quantity')::numeric <> 2
     OR (v_row->>'movement_quantity')::numeric <> 1
     OR (v_row->>'movement_book_value')::numeric <> 130
     OR (v_row->>'movement_count')::integer <> 2
     OR (v_row->>'quantity_difference')::numeric <> 1
     OR NOT COALESCE((v_row->>'can_prepare_repair')::boolean, false) THEN
    RAISE EXCEPTION 'STAGING_STALE_SETUP_POSTCHECK_FAILED';
  END IF;
END;
$postcheck$;
SELECT jsonb_build_object('result', 'STAGING_STALE_SETUP_OK',
  'card_quantity', 2, 'movement_quantity', 1) AS result;
${commit ? "COMMIT;" : "ROLLBACK;"}
`;
}

function revertSetupSql() {
  return `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $guard$
DECLARE v_row jsonb;
BEGIN
  IF current_database() <> 'postgres' OR current_setting('server_version') <> '17.6' THEN
    RAISE EXCEPTION 'STAGING_STALE_ENVIRONMENT_INVALID';
  END IF;
  v_row := ${diagnosticRow};
  IF v_row IS NULL OR v_row->>'classification' <> 'product_balance'
     OR (v_row->>'card_quantity')::numeric <> 2
     OR (v_row->>'movement_quantity')::numeric <> 1
     OR (v_row->>'movement_book_value')::numeric <> 130
     OR (v_row->>'movement_count')::integer <> 2
     OR EXISTS (
       SELECT 1 FROM public.inventory_reconciliation_repair_items i
       JOIN public.inventory_reconciliation_repairs r ON r.id = i.repair_id
       WHERE i.product_id = '${productId}'::uuid
         AND r.status IN ('draft', 'ready_for_review', 'approved')
     ) THEN
    RAISE EXCEPTION 'STAGING_STALE_REVERT_PRECONDITION_CHANGED';
  END IF;
END;
$guard$;
UPDATE public.products SET quantity_on_hand = 1
WHERE id = '${productId}'::uuid AND code = 'PRD-002' AND quantity_on_hand = 2;
DO $postcheck$
DECLARE v_row jsonb;
BEGIN
  v_row := ${diagnosticRow};
  IF v_row IS NULL OR v_row->>'classification' <> 'matched'
     OR (v_row->>'card_quantity')::numeric <> 1
     OR (v_row->>'movement_quantity')::numeric <> 1 THEN
    RAISE EXCEPTION 'STAGING_STALE_REVERT_POSTCHECK_FAILED';
  END IF;
END;
$postcheck$;
SELECT 'STAGING_STALE_SETUP_REVERTED' AS result;
COMMIT;
`;
}

function abortReviewSql() {
  return `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $abort$
DECLARE v_row jsonb; v_repair record; v_actor uuid; v_result jsonb;
BEGIN
  IF current_database() <> 'postgres' OR current_setting('server_version') <> '17.6' THEN
    RAISE EXCEPTION 'STAGING_STALE_ENVIRONMENT_INVALID';
  END IF;
  v_row := ${diagnosticRow};
  IF v_row IS NULL OR v_row->>'classification' <> 'product_balance'
     OR (v_row->>'card_quantity')::numeric <> 2
     OR (v_row->>'movement_quantity')::numeric <> 1
     OR (v_row->>'movement_book_value')::numeric <> 130
     OR (v_row->>'movement_count')::integer <> 2 THEN
    RAISE EXCEPTION 'STAGING_STALE_TARGET_CHANGED';
  END IF;
  SELECT r.id, r.version, r.status, i.before_card_quantity,
    i.before_movement_quantity, i.proposed_card_quantity, i.result_status
  INTO v_repair
  FROM public.inventory_reconciliation_repairs r
  JOIN public.inventory_reconciliation_repair_items i ON i.repair_id = r.id
  WHERE i.product_id = '${productId}'::uuid
    AND r.status IN ('draft', 'ready_for_review', 'approved');
  IF NOT FOUND OR v_repair.before_card_quantity <> 2
     OR v_repair.before_movement_quantity <> 1
     OR v_repair.proposed_card_quantity <> 1
     OR v_repair.result_status <> 'pending'
     OR (SELECT count(*) FROM public.inventory_reconciliation_repair_items i
       WHERE i.repair_id = v_repair.id) <> 1
     OR (SELECT count(*) FROM public.inventory_reconciliation_repair_items i
       JOIN public.inventory_reconciliation_repairs r ON r.id = i.repair_id
       WHERE i.product_id = '${productId}'::uuid
         AND r.status IN ('draft', 'ready_for_review', 'approved')) <> 1
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_effects e
       WHERE e.repair_id = v_repair.id) THEN
    RAISE EXCEPTION 'STAGING_STALE_REPAIR_CHANGED';
  END IF;
  SELECT approved_by INTO v_actor FROM public.inventory_reconciliation_repairs
  WHERE repair_number = 12 AND status = 'executed';
  IF v_actor IS NULL OR NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'STAGING_STALE_CLEANUP_ACTOR_INVALID';
  END IF;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_actor)::text, true);
  IF auth.uid() IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'STAGING_STALE_CLEANUP_ACTOR_INVALID';
  END IF;
  v_result := public.cancel_inventory_reconciliation_repair(
    v_repair.id, 'إيقاف اختبار الاقتراح القديم قبل تغيير البطاقة على Staging',
    v_repair.version, '${randomUUID()}'::uuid
  );
  IF v_result->>'status' <> 'cancelled' THEN
    RAISE EXCEPTION 'STAGING_STALE_CANCEL_FAILED';
  END IF;
  UPDATE public.products SET quantity_on_hand = 1
  WHERE id = '${productId}'::uuid AND code = 'PRD-002' AND quantity_on_hand = 2;
  v_row := ${diagnosticRow};
  IF v_row IS NULL OR v_row->>'classification' <> 'matched'
     OR (v_row->>'card_quantity')::numeric <> 1
     OR (v_row->>'movement_quantity')::numeric <> 1
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_effects e
       WHERE e.repair_id = v_repair.id) THEN
    RAISE EXCEPTION 'STAGING_STALE_ABORT_POSTCHECK_FAILED';
  END IF;
END;
$abort$;
SELECT 'STAGING_STALE_REVIEW_ABORTED' AS result;
COMMIT;
`;
}

function activeRepairGuard(cardQuantity, status) {
  return `DO $guard$
DECLARE v_row jsonb; v_repair record;
BEGIN
  IF current_database() <> 'postgres' OR current_setting('server_version') <> '17.6'
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
       WHERE version = '20260914190000') THEN
    RAISE EXCEPTION 'STAGING_STALE_ENVIRONMENT_INVALID';
  END IF;
  v_row := ${diagnosticRow};
  IF v_row IS NULL OR v_row->>'classification' <> 'product_balance'
     OR (v_row->>'card_quantity')::numeric <> ${cardQuantity}
     OR (v_row->>'movement_quantity')::numeric <> 1
     OR (v_row->>'movement_book_value')::numeric <> 130
     OR (v_row->>'movement_count')::integer <> 2 THEN
    RAISE EXCEPTION 'STAGING_STALE_TARGET_CHANGED';
  END IF;
  SELECT r.id, r.status, r.version, r.approved_by, i.id AS item_id,
    i.before_card_quantity, i.before_movement_quantity,
    i.proposed_card_quantity, i.result_status
  INTO v_repair
  FROM public.inventory_reconciliation_repairs r
  JOIN public.inventory_reconciliation_repair_items i ON i.repair_id = r.id
  WHERE i.product_id = '${productId}'::uuid
    AND r.status IN ('draft', 'ready_for_review', 'approved');
  IF NOT FOUND OR v_repair.status <> '${status}'
     OR v_repair.before_card_quantity <> 2
     OR v_repair.before_movement_quantity <> 1
     OR v_repair.proposed_card_quantity IS NULL
     OR v_repair.proposed_card_quantity <> 1
     OR v_repair.result_status <> 'pending'
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_effects e
       WHERE e.repair_id = v_repair.id)
     OR (SELECT count(*) FROM public.inventory_reconciliation_repair_items i
       WHERE i.repair_id = v_repair.id) <> 1
     OR (SELECT count(*) FROM public.inventory_reconciliation_repair_items i
       JOIN public.inventory_reconciliation_repairs r ON r.id = i.repair_id
       WHERE i.product_id = '${productId}'::uuid
         AND r.status IN ('draft', 'ready_for_review', 'approved')) <> 1 THEN
    RAISE EXCEPTION 'STAGING_STALE_REPAIR_CHANGED';
  END IF;
END;
$guard$;`;
}

function markStaleSql() {
  return `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
${activeRepairGuard(2, "approved")}
UPDATE public.products SET quantity_on_hand = 3
WHERE id = '${productId}'::uuid AND code = 'PRD-002' AND quantity_on_hand = 2;
DO $postcheck$
DECLARE v_row jsonb;
BEGIN
  v_row := ${diagnosticRow};
  IF v_row IS NULL OR v_row->>'classification' <> 'product_balance'
     OR (v_row->>'card_quantity')::numeric <> 3
     OR (v_row->>'movement_quantity')::numeric <> 1
     OR (v_row->>'quantity_difference')::numeric <> 2 THEN
    RAISE EXCEPTION 'STAGING_STALE_CHANGE_POSTCHECK_FAILED';
  END IF;
END;
$postcheck$;
SELECT jsonb_build_object('result', 'STAGING_APPROVED_REPAIR_NOW_STALE',
  'repair_number', r.repair_number, 'version', r.version,
  'card_quantity', 3, 'movement_quantity', 1) AS result
FROM public.inventory_reconciliation_repairs r
JOIN public.inventory_reconciliation_repair_items i ON i.repair_id = r.id
WHERE i.product_id = '${productId}'::uuid AND r.status = 'approved';
COMMIT;
`;
}

function cleanupSql() {
  return `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
${activeRepairGuard(3, "approved")}
DO $cleanup$
DECLARE v_repair record; v_result jsonb; v_row jsonb;
BEGIN
  SELECT r.id, r.version, r.approved_by INTO STRICT v_repair
  FROM public.inventory_reconciliation_repairs r
  JOIN public.inventory_reconciliation_repair_items i ON i.repair_id = r.id
  WHERE i.product_id = '${productId}'::uuid AND r.status = 'approved';
  IF v_repair.approved_by IS NULL
     OR NOT public.has_role(v_repair.approved_by, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'STAGING_STALE_CLEANUP_ACTOR_INVALID';
  END IF;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_repair.approved_by)::text, true);
  IF auth.uid() IS DISTINCT FROM v_repair.approved_by THEN
    RAISE EXCEPTION 'STAGING_STALE_CLEANUP_ACTOR_INVALID';
  END IF;
  v_result := public.cancel_inventory_reconciliation_repair(
    v_repair.id, 'انتهى اختبار رفض تنفيذ اقتراح قديم على Staging',
    v_repair.version, '${randomUUID()}'::uuid
  );
  IF v_result->>'status' <> 'cancelled' THEN
    RAISE EXCEPTION 'STAGING_STALE_CANCEL_FAILED';
  END IF;
  UPDATE public.products SET quantity_on_hand = 1
  WHERE id = '${productId}'::uuid AND code = 'PRD-002' AND quantity_on_hand = 3;
  v_row := ${diagnosticRow};
  IF v_row IS NULL OR v_row->>'classification' <> 'matched'
     OR (v_row->>'card_quantity')::numeric <> 1
     OR (v_row->>'movement_quantity')::numeric <> 1
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_effects e
       WHERE e.repair_id = v_repair.id)
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_events e
       WHERE e.repair_id = v_repair.id AND e.event_type = 'executed') THEN
    RAISE EXCEPTION 'STAGING_STALE_CLEANUP_POSTCHECK_FAILED';
  END IF;
END;
$cleanup$;
SELECT 'STAGING_STALE_CLEANUP_OK' AS result;
COMMIT;
`;
}

function runCli(sql, label) {
  assertStagingLink();
  process.umask(0o077);
  const reportDir = mkdtempSync(`/tmp/accounting-staging-stale-${label}-`);
  const sqlPath = join(reportDir, `${label}.sql`);
  const logPath = join(reportDir, "run.log");
  const reportPath = join(reportDir, "report.json");
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  const result = spawnSync("npx", ["-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", sqlPath], {
    cwd: root, encoding: "utf8", timeout: 240000, maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\n`, { mode: 0o600 });
    throw new Error(`فشلت خطوة ${label} على Staging؛ التشخيص المحمي: ${logPath}`);
  }
  const parsed = JSON.parse(result.stdout);
  const marker = parsed.rows?.find((row) => row.result)?.result;
  writeFileSync(reportPath, `${JSON.stringify({ marker, projectRef: expectedProjectRef,
    step: label, verifiedAt: new Date().toISOString(), productionModified: false }, null, 2)}\n`, { mode: 0o600 });
  return { marker, reportDir };
}

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--rehearse-setup", "--setup", "--revert-setup",
    "--abort-review", "--mark-stale", "--cleanup"].includes(mode)
      || process.argv.length > 3) {
    throw new Error("استخدم --check أو --rehearse-setup أو --setup أو --revert-setup أو --abort-review أو --mark-stale أو --cleanup");
  }
  assertStagingLink();
  const baseline = loadBaseline();
  if (mode === "--check") {
    console.log("حواجز Staging والنسخة وخطة تنظيف الاختبار جاهزة؛ لم تتغير قاعدة البيانات");
    return;
  }
  const sql = mode === "--rehearse-setup" || mode === "--setup"
    ? setupSql(baseline, mode === "--setup")
    : mode === "--revert-setup" ? revertSetupSql()
      : mode === "--abort-review" ? abortReviewSql()
        : mode === "--mark-stale" ? markStaleSql() : cleanupSql();
  const expected = {
    "--rehearse-setup": "STAGING_STALE_SETUP_OK",
    "--setup": "STAGING_STALE_SETUP_OK",
    "--revert-setup": "STAGING_STALE_SETUP_REVERTED",
    "--abort-review": "STAGING_STALE_REVIEW_ABORTED",
    "--mark-stale": "STAGING_APPROVED_REPAIR_NOW_STALE",
    "--cleanup": "STAGING_STALE_CLEANUP_OK",
  }[mode];
  const { marker, reportDir } = runCli(sql, mode.slice(2));
  const value = typeof marker === "string" ? marker : marker?.result;
  if (value !== expected) throw new Error(`علامة نتيجة ${mode} غير صحيحة؛ التقرير: ${reportDir}`);
  if (mode === "--rehearse-setup") {
    const verification = runCli(`BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
${baselineGuard(baseline)}
SELECT 'STAGING_STALE_REHEARSAL_ROLLED_BACK' AS result;
ROLLBACK;`, "post-rehearsal");
    if (verification.marker !== "STAGING_STALE_REHEARSAL_ROLLED_BACK") {
      throw new Error(`لم يثبت رجوع تجربة Staging؛ التقرير: ${verification.reportDir}`);
    }
  }
  console.log(mode === "--rehearse-setup"
    ? "نجحت تجربة إعداد الفرق داخل معاملة انتهت برجوع كامل"
    : mode === "--setup" ? "أُعد فرق Staging المضبوط للمنتج PRD-002"
      : mode === "--revert-setup" ? "أُزيل فرق Staging قبل إنشاء معالجة"
        : mode === "--abort-review" ? "أُلغيت المعالجة التجريبية قبل إكمال الاعتماد وعادت البطاقة"
          : mode === "--mark-stale" ? "أصبحت المعالجة المعتمدة قديمة بعد تغيير البطاقة على Staging"
            : "أُلغيت المعالجة التجريبية وعادت بطاقة المنتج إلى الحركات");
  console.log(`REPORT_DIR=${reportDir}`);
  if (mode === "--mark-stale") console.log(`REPAIR_NUMBER=${marker.repair_number}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
