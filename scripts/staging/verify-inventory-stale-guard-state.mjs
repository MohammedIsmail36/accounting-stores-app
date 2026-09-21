// Read-only verification of each stage of the controlled stale-repair test.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const baselineDir = "/tmp/staging-inventory-stale-guard-before-PNnzfw";
const productId = "2e364454-c894-48f4-bb47-1389ee723336";
const cli = "supabase@2.116.0";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function loadBaseline() {
  if (readFileSync(join(root, "supabase/.temp/project-ref"), "utf8").trim() !== expectedProjectRef) {
    throw new Error("المشروع المرتبط ليس Staging المعتمد");
  }
  const manifest = JSON.parse(readFileSync(join(baselineDir, "manifest.json"), "utf8"));
  if (manifest.result !== "STAGING_INVENTORY_STALE_GUARD_BASELINE_OK"
      || manifest.projectRef !== expectedProjectRef
      || manifest.files?.["baseline.json"]?.sha256 !== sha256(join(baselineDir, "baseline.json"))) {
    throw new Error("خط الأساس المحمي غير صالح");
  }
  return JSON.parse(readFileSync(join(baselineDir, "baseline.json"), "utf8"));
}

const sql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
WITH target AS (
  SELECT * FROM public.products WHERE id = '${productId}'::uuid AND code = 'PRD-002'
), diagnostic AS (
  SELECT value AS row_data FROM jsonb_array_elements(
    public.get_inventory_reconciliation_diagnostic('products', false, 'PRD-002', 500, 0, NULL)->'rows'
  ) WHERE value->>'product_id' = '${productId}'
), test_repair AS (
  SELECT r.*, i.id AS item_id, i.result_status, i.before_card_quantity,
    i.before_movement_quantity, i.proposed_card_quantity
  FROM public.inventory_reconciliation_repairs r
  JOIN public.inventory_reconciliation_repair_items i ON i.repair_id = r.id
  WHERE i.product_id = '${productId}'::uuid AND r.repair_number <> 12
)
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'product', (SELECT jsonb_build_object('id', id, 'code', code,
    'quantity_on_hand', quantity_on_hand) FROM target),
  'diagnostic', (SELECT row_data FROM diagnostic),
  'movements', (SELECT jsonb_build_object(
    'count', count(*),
    'quantity', COALESCE(sum(public.inventory_signed_quantity(movement_type::text, quantity)), 0),
    'book_value', COALESCE(sum(CASE
      WHEN movement_type::text = 'adjustment' THEN sign(COALESCE(quantity, 0)) * abs(COALESCE(total_cost, 0))
      WHEN movement_type::text IN ('sale', 'purchase_return') THEN -abs(COALESCE(total_cost, 0))
      ELSE abs(COALESCE(total_cost, 0))
    END), 0)
  ) FROM public.inventory_movements WHERE product_id = '${productId}'::uuid),
  'test_repair', (SELECT jsonb_build_object(
    'repair_number', repair_number, 'status', status, 'version', version,
    'item_status', result_status,
    'before_card_quantity', before_card_quantity,
    'before_movement_quantity', before_movement_quantity,
    'proposed_card_quantity', proposed_card_quantity,
    'effect_count', (SELECT count(*) FROM public.inventory_reconciliation_repair_effects e
      WHERE e.repair_id = test_repair.id),
    'events', (SELECT jsonb_agg(e.event_type ORDER BY e.created_at, e.id)
      FROM public.inventory_reconciliation_repair_events e
      WHERE e.repair_id = test_repair.id)
  ) FROM test_repair),
  'test_repair_count', (SELECT count(*) FROM test_repair),
  'counts', jsonb_build_object(
    'products', (SELECT count(*) FROM public.products),
    'inventory_movements', (SELECT count(*) FROM public.inventory_movements),
    'sales_invoices', (SELECT count(*) FROM public.sales_invoices),
    'purchase_invoices', (SELECT count(*) FROM public.purchase_invoices),
    'journal_entries', (SELECT count(*) FROM public.journal_entries),
    'journal_entry_lines', (SELECT count(*) FROM public.journal_entry_lines),
    'repairs', (SELECT count(*) FROM public.inventory_reconciliation_repairs),
    'repair_items', (SELECT count(*) FROM public.inventory_reconciliation_repair_items),
    'repair_effects', (SELECT count(*) FROM public.inventory_reconciliation_repair_effects),
    'repair_events', (SELECT count(*) FROM public.inventory_reconciliation_repair_events)
  ),
  'financial_signatures', jsonb_build_object(
    'inventory_movements', (SELECT md5(COALESCE(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id), '')) FROM public.inventory_movements m),
    'sales_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), '')) FROM public.sales_invoices s),
    'purchase_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.purchase_invoices p),
    'journal_entries', (SELECT md5(COALESCE(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id), '')) FROM public.journal_entries j),
    'journal_entry_lines', (SELECT md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), '')) FROM public.journal_entry_lines l)
  )
) AS state;
ROLLBACK;
`;

function assert(value, label) {
  if (!value) throw new Error(`فشل تحقق ${label}`);
}

function verify(state, baseline, mode) {
  assert(state.database === "postgres" && state.server_version === "17.6", "هوية Staging");
  assert(state.product?.id === productId && state.product?.code === "PRD-002", "هوية المنتج");
  assert(state.movements?.count === 2 && state.movements.quantity === 1
    && state.movements.book_value === 130, "حركات المنتج وتكلفتها");
  for (const [name, signature] of Object.entries(state.financial_signatures ?? {})) {
    assert(signature === baseline.signatures?.[name], `بصمة ${name}`);
    assert(state.counts?.[name] === baseline.counts?.[name], `عدد ${name}`);
  }
  assert(state.counts.products === baseline.counts.products, "عدد المنتجات");

  const expectedCard = mode === "after-setup" || mode === "after-draft" || mode === "after-review" ? 2
    : mode === "after-stale" || mode === "after-rejection" ? 3 : 1;
  assert(state.product.quantity_on_hand === expectedCard
    && state.diagnostic?.card_quantity === expectedCard
    && state.diagnostic?.movement_quantity === 1, "كمية البطاقة والتشخيص");
  assert(state.diagnostic?.classification === (expectedCard === 1 ? "matched" : "product_balance"),
    "تصنيف التشخيص");

  if (mode === "after-setup") {
    assert(state.test_repair_count === 0 && state.test_repair === null, "غياب معالجة قبل إنشائها");
    assert(state.counts.repairs === baseline.counts.repairs
      && state.counts.repair_effects === baseline.counts.repair_effects, "ثبات المعالجات");
    return;
  }
  assert(state.test_repair_count === 1, "وجود معالجة تجريبية واحدة");
  const repair = state.test_repair;
  assert(repair.repair_number === 13
    && repair.before_card_quantity === 2 && repair.before_movement_quantity === 1
    && repair.proposed_card_quantity === 1 && repair.item_status === "pending"
    && repair.effect_count === 0, "البند وصفر آثار");
  assert(state.counts.repair_effects === baseline.counts.repair_effects, "ثبات إجمالي الآثار");
  assert(state.counts.repairs === baseline.counts.repairs + 1, "عدد المعالجات");
  if (mode === "after-draft") {
    assert(repair.status === "draft" && repair.version === 1
      && JSON.stringify(repair.events) === JSON.stringify(["created"])
      && state.counts.repair_events === baseline.counts.repair_events + 1,
      "حالة المسودة");
  } else if (mode === "after-cleanup") {
    assert(repair.status === "cancelled" && repair.version === 4
      && JSON.stringify(repair.events) === JSON.stringify(["created", "submitted", "approved", "cancelled"])
      && state.counts.repair_events === baseline.counts.repair_events + 4,
      "إلغاء المعالجة");
  } else {
    assert(repair.status === "approved" && repair.version === 3
      && JSON.stringify(repair.events) === JSON.stringify(["created", "submitted", "approved"])
      && state.counts.repair_events === baseline.counts.repair_events + 3,
      "بقاء الاعتماد دون تنفيذ");
  }
}

function main() {
  const mode = process.argv[2];
  if (!["after-setup", "after-draft", "after-review", "after-stale", "after-rejection", "after-cleanup"].includes(mode)
      || process.argv.length !== 3) {
    throw new Error("حدد مرحلة تحقق واحدة: after-setup|after-draft|after-review|after-stale|after-rejection|after-cleanup");
  }
  const baseline = loadBaseline();
  process.umask(0o077);
  const reportDir = mkdtempSync(`/tmp/accounting-staging-stale-verify-${mode}-`);
  const sqlPath = join(reportDir, "verification.sql");
  const reportPath = join(reportDir, "report.json");
  const logPath = join(reportDir, "run.log");
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  const result = spawnSync("npx", ["-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", sqlPath], {
    cwd: root, encoding: "utf8", timeout: 240000, maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\n`, { mode: 0o600 });
    throw new Error(`تعذر قراءة Staging؛ التشخيص المحمي: ${logPath}`);
  }
  const state = JSON.parse(result.stdout).rows?.[0]?.state;
  assert(state, "استجابة Staging");
  verify(state, baseline, mode);
  writeFileSync(reportPath, `${JSON.stringify({ result: "STAGING_STALE_STATE_OK",
    mode, state, verifiedAt: new Date().toISOString(), projectRef: expectedProjectRef,
    readOnly: true, productionModified: false }, null, 2)}\n`, { mode: 0o600 });
  console.log(`نجح تحقق ${mode}: البطاقة=${state.product.quantity_on_hand} الحركات=1، الآثار الجديدة=0`);
  if (state.test_repair) console.log(`REPAIR_NUMBER=${state.test_repair.repair_number}`);
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
