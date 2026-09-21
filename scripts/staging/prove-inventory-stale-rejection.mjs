// Proves on Staging that an approved stale product-card repair is rejected atomically.
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const baselinePath = "/tmp/staging-inventory-stale-guard-before-PNnzfw/baseline.json";
const productId = "2e364454-c894-48f4-bb47-1389ee723336";
const cli = "supabase@2.116.0";

function literal(value) {
  if (!/^[0-9a-f]{32}$/.test(value)) throw new Error("بصمة خط أساس غير صالحة");
  return value;
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const signatures = Object.fromEntries([
    "inventory_movements", "sales_invoices", "purchase_invoices",
    "journal_entries", "journal_entry_lines",
  ].map((name) => [name, literal(baseline.signatures?.[name])]));
  const requestId = randomUUID();
  const sql = `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $proof$
DECLARE v_repair record; v_row jsonb; v_rejected boolean := false;
BEGIN
  IF current_database() <> 'postgres' OR current_setting('server_version') <> '17.6'
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
       WHERE version = '20260914190000') THEN
    RAISE EXCEPTION 'STAGING_STALE_ENVIRONMENT_INVALID';
  END IF;
  SELECT r.id, r.status, r.version, r.approved_by, i.id AS item_id,
    i.before_card_quantity, i.before_movement_quantity,
    i.before_movement_book_value, i.proposed_card_quantity, i.result_status
  INTO STRICT v_repair
  FROM public.inventory_reconciliation_repairs r
  JOIN public.inventory_reconciliation_repair_items i ON i.repair_id = r.id
  WHERE r.repair_number = 13 AND i.product_id = '${productId}'::uuid;
  IF v_repair.status <> 'approved' OR v_repair.version <> 3
     OR v_repair.approved_by IS NULL
     OR NOT public.has_role(v_repair.approved_by, 'admin'::public.app_role)
     OR v_repair.before_card_quantity <> 2
     OR v_repair.before_movement_quantity <> 1
     OR v_repair.before_movement_book_value <> 130
     OR v_repair.proposed_card_quantity <> 1
     OR v_repair.result_status <> 'pending'
     OR (SELECT quantity_on_hand FROM public.products
       WHERE id = '${productId}'::uuid) <> 3
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_effects e
       WHERE e.repair_id = v_repair.id)
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_events e
       WHERE e.repair_id = v_repair.id AND e.event_type = 'executed') THEN
    RAISE EXCEPTION 'STAGING_STALE_PRECONDITION_INVALID';
  END IF;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_repair.approved_by)::text, true);
  BEGIN
    PERFORM public.execute_inventory_reconciliation_repair(
      v_repair.id, v_repair.version, '${requestId}'::uuid
    );
  EXCEPTION WHEN SQLSTATE '40001' THEN
    IF SQLERRM = 'REPAIR_PRECONDITION_CHANGED' THEN v_rejected := true;
    ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'STALE_REPAIR_WAS_NOT_REJECTED'; END IF;
  v_row := (SELECT value FROM jsonb_array_elements(
    public.get_inventory_reconciliation_diagnostic('products', false, 'PRD-002', 500, 0, NULL)->'rows'
  ) WHERE value->>'product_id' = '${productId}' LIMIT 1);
  IF v_row IS NULL OR v_row->>'classification' <> 'product_balance'
     OR (v_row->>'card_quantity')::numeric <> 3
     OR (v_row->>'movement_quantity')::numeric <> 1
     OR (v_row->>'movement_book_value')::numeric <> 130
     OR (SELECT status FROM public.inventory_reconciliation_repairs WHERE id = v_repair.id) <> 'approved'
     OR (SELECT version FROM public.inventory_reconciliation_repairs WHERE id = v_repair.id) <> 3
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_effects e WHERE e.repair_id = v_repair.id)
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_events e
       WHERE e.repair_id = v_repair.id AND e.event_type = 'executed')
     OR (SELECT md5(COALESCE(string_agg(to_jsonb(t)::text, '|' ORDER BY t.id), '')) FROM public.inventory_movements t) <> '${signatures.inventory_movements}'
     OR (SELECT md5(COALESCE(string_agg(to_jsonb(t)::text, '|' ORDER BY t.id), '')) FROM public.sales_invoices t) <> '${signatures.sales_invoices}'
     OR (SELECT md5(COALESCE(string_agg(to_jsonb(t)::text, '|' ORDER BY t.id), '')) FROM public.purchase_invoices t) <> '${signatures.purchase_invoices}'
     OR (SELECT md5(COALESCE(string_agg(to_jsonb(t)::text, '|' ORDER BY t.id), '')) FROM public.journal_entries t) <> '${signatures.journal_entries}'
     OR (SELECT md5(COALESCE(string_agg(to_jsonb(t)::text, '|' ORDER BY t.id), '')) FROM public.journal_entry_lines t) <> '${signatures.journal_entry_lines}' THEN
    RAISE EXCEPTION 'STAGING_STALE_REJECTION_POSTCHECK_FAILED';
  END IF;
END;
$proof$;
COMMIT;
SELECT jsonb_build_object(
  'result', 'STAGING_STALE_REJECTION_PROVED',
  'repair_number', 13,
  'status', (SELECT status FROM public.inventory_reconciliation_repairs WHERE repair_number = 13),
  'version', (SELECT version FROM public.inventory_reconciliation_repairs WHERE repair_number = 13),
  'card_quantity', (SELECT quantity_on_hand FROM public.products WHERE id = '${productId}'::uuid),
  'effect_count', (SELECT count(*) FROM public.inventory_reconciliation_repair_effects e
    JOIN public.inventory_reconciliation_repairs r ON r.id = e.repair_id WHERE r.repair_number = 13),
  'executed_event_count', (SELECT count(*) FROM public.inventory_reconciliation_repair_events e
    JOIN public.inventory_reconciliation_repairs r ON r.id = e.repair_id
    WHERE r.repair_number = 13 AND e.event_type = 'executed')
) AS result;
`;
  process.umask(0o077);
  const reportDir = mkdtempSync("/tmp/accounting-staging-stale-rejection-proof-");
  const sqlPath = join(reportDir, "proof.sql");
  const logPath = join(reportDir, "run.log");
  const reportPath = join(reportDir, "report.json");
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  const result = spawnSync("npx", ["-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", sqlPath], {
    cwd: root, encoding: "utf8", timeout: 240000, maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\n`, { mode: 0o600 });
    throw new Error(`فشل إثبات رفض المعالجة القديمة؛ التشخيص المحمي: ${logPath}`);
  }
  const proof = JSON.parse(result.stdout).rows?.find((row) => row.result)?.result;
  if (proof?.result !== "STAGING_STALE_REJECTION_PROVED" || proof.repair_number !== 13
      || proof.status !== "approved" || proof.version !== 3 || proof.card_quantity !== 3
      || proof.effect_count !== 0 || proof.executed_event_count !== 0) {
    throw new Error(`نتيجة إثبات الرفض غير صحيحة؛ الملفات المحمية: ${reportDir}`);
  }
  writeFileSync(reportPath, `${JSON.stringify({ ...proof, projectRef: expectedProjectRef,
    requestId, verifiedAt: new Date().toISOString(), productionModified: false }, null, 2)}\n`, { mode: 0o600 });
  console.log("ثبت رفض IR-0013 بسبب تغير البطاقة بعد الاعتماد، دون أي أثر جزئي");
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
