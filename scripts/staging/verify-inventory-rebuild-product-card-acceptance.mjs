// Read-only verification of the controlled stage-2C acceptance execution.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deepStrictEqual } from "node:assert";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const cli = "supabase@2.116.0";
const productId = "2e364454-c894-48f4-bb47-1389ee723336";
const productCode = "PRD-002";
const repairNumber = 12;
const expectedFingerprint = "9b453def7dde286953493f04b52b89e3";

export function validateAcceptanceVerificationSource(source) {
  for (const required of [
    expectedProjectRef,
    productId,
    productCode,
    expectedFingerprint,
    "STAGING_REBUILD_ACCEPTANCE_EXECUTION_OK",
    "BEGIN TRANSACTION READ ONLY;",
    "ROLLBACK;",
  ]) {
    if (!source.includes(required)) throw new Error(`حاجز تحقق قبول 2C مفقود: ${required}`);
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

const sql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
WITH repair AS (
  SELECT * FROM public.inventory_reconciliation_repairs WHERE repair_number = ${repairNumber}
), item AS (
  SELECT i.* FROM public.inventory_reconciliation_repair_items i
  JOIN repair r ON r.id = i.repair_id
), diagnostic AS (
  SELECT value AS row_data
  FROM jsonb_array_elements(public.get_inventory_reconciliation_diagnostic(
    'products', false, '${productCode}', 500, 0, NULL
  )->'rows')
  WHERE value->>'product_id' = '${productId}'
), global_diagnostic AS (
  SELECT public.get_inventory_reconciliation_diagnostic(
    'summary', true, NULL, 100, 0, NULL
  ) AS payload
)
SELECT jsonb_build_object(
  'result', 'STAGING_REBUILD_ACCEPTANCE_EXECUTION_OK',
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'repair', (SELECT jsonb_build_object(
    'count', count(*),
    'status', min(status),
    'version', min(version),
    'executed', bool_and(executed_at IS NOT NULL AND executed_by IS NOT NULL)
  ) FROM repair),
  'item', (SELECT jsonb_build_object(
    'count', count(*),
    'axis', min(axis),
    'classification', min(classification),
    'repair_type', min(repair_type),
    'result_status', min(result_status),
    'product_id', min(product_id::text),
    'before_card_quantity', min(before_card_quantity),
    'before_movement_quantity', min(before_movement_quantity),
    'before_movement_book_value', min(before_movement_book_value),
    'proposed_card_quantity', min(proposed_card_quantity),
    'after_card_quantity', min(after_card_quantity),
    'after_movement_quantity', min(after_movement_quantity),
    'after_movement_book_value', min(after_movement_book_value)
  ) FROM item),
  'events', (SELECT jsonb_build_object(
    'count', count(*),
    'types', jsonb_agg(e.event_type ORDER BY e.created_at, e.id),
    'unique_requests', count(DISTINCT request_id)
  ) FROM public.inventory_reconciliation_repair_events e JOIN repair r ON r.id = e.repair_id),
  'effect', (SELECT jsonb_build_object(
    'count', count(*),
    'effect_type', min(effect_type),
    'table_name', min(table_name),
    'record_id', min(record_id::text),
    'before_data', min(before_data::text)::jsonb,
    'after_data', min(after_data::text)::jsonb
  ) FROM public.inventory_reconciliation_repair_effects e JOIN repair r ON r.id = e.repair_id),
  'product', (SELECT jsonb_build_object(
    'count', count(*), 'code', min(code), 'name', min(name),
    'purchase_price', min(purchase_price), 'selling_price', min(selling_price),
    'quantity_on_hand', min(quantity_on_hand), 'min_stock_level', min(min_stock_level),
    'is_active', bool_and(is_active), 'brand_id', min(brand_id::text),
    'category_id', min(category_id::text), 'unit_id', min(unit_id::text),
    'model_number', min(model_number), 'barcode', min(barcode),
    'barcode_label', min(barcode_label), 'barcode_price', min(barcode_price)
  ) FROM public.products WHERE id = '${productId}'::uuid),
  'target_movements', (SELECT jsonb_build_object(
    'count', count(*),
    'signed_quantity', COALESCE(sum(public.inventory_signed_quantity(movement_type::text, quantity)), 0),
    'book_value', COALESCE(sum(CASE
      WHEN movement_type::text = 'adjustment' THEN sign(COALESCE(quantity, 0)) * abs(COALESCE(total_cost, 0))
      WHEN movement_type::text IN ('sale', 'purchase_return') THEN -abs(COALESCE(total_cost, 0))
      ELSE abs(COALESCE(total_cost, 0))
    END), 0)
  ) FROM public.inventory_movements WHERE product_id = '${productId}'::uuid),
  'diagnostic', (SELECT row_data FROM diagnostic),
  'global_fingerprint', (SELECT payload->>'fingerprint' FROM global_diagnostic),
  'global_quantity_difference', (SELECT (payload#>>'{totals,quantity_difference}')::numeric FROM global_diagnostic),
  'counts', jsonb_build_object(
    'products', (SELECT count(*) FROM public.products),
    'inventory_movements', (SELECT count(*) FROM public.inventory_movements),
    'journal_entries', (SELECT count(*) FROM public.journal_entries),
    'journal_entry_lines', (SELECT count(*) FROM public.journal_entry_lines),
    'repairs', (SELECT count(*) FROM public.inventory_reconciliation_repairs),
    'repair_items', (SELECT count(*) FROM public.inventory_reconciliation_repair_items),
    'repair_effects', (SELECT count(*) FROM public.inventory_reconciliation_repair_effects),
    'repair_events', (SELECT count(*) FROM public.inventory_reconciliation_repair_events)
  ),
  'immutable_signatures', jsonb_build_object(
    'inventory_movements', (SELECT md5(COALESCE(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id), '')) FROM public.inventory_movements m),
    'sales_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), '')) FROM public.sales_invoices s),
    'purchase_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.purchase_invoices p),
    'journal_entries', (SELECT md5(COALESCE(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id), '')) FROM public.journal_entries j),
    'journal_entry_lines', (SELECT md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), '')) FROM public.journal_entry_lines l)
  )
) AS verification;
ROLLBACK;
`;

function same(value, expected, label) {
  try {
    deepStrictEqual(value, expected);
  } catch {
    throw new Error(`فشل تحقق ${label}: ${JSON.stringify(value)}`);
  }
}

function main() {
  if (process.argv.length > 2) throw new Error("هذا الفاحص لا يقبل معاملات");
  validateAcceptanceVerificationSource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  const linkedRef = readFileSync(projectRefPath, "utf8").trim();
  if (linkedRef !== expectedProjectRef) throw new Error("رفض الفحص: المشروع المرتبط ليس Staging المعتمد");

  const reportDir = mkdtempSync("/tmp/accounting-staging-rebuild-acceptance-verification-");
  const sqlPath = join(reportDir, "verification.sql");
  const reportPath = join(reportDir, "report.json");
  const logPath = join(reportDir, "run.log");
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  const result = spawnSync("npx", [
    "-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", sqlPath,
  ], { cwd: root, encoding: "utf8", timeout: 240000, maxBuffer: 32 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    writeFileSync(logPath, output, { mode: 0o600 });
    throw new Error(`فشل تحقق قبول 2C؛ التشخيص المحمي: ${logPath}`);
  }
  const verification = JSON.parse(result.stdout).rows?.[0]?.verification;
  if (!verification || verification.result !== "STAGING_REBUILD_ACCEPTANCE_EXECUTION_OK") {
    throw new Error("لم تعد قاعدة Staging نتيجة التحقق المتوقعة");
  }

  same(verification.repair, { count: 1, status: "executed", version: 4, executed: true }, "رأس المعالجة");
  same(verification.item, {
    count: 1, axis: "product", classification: "product_balance",
    repair_type: "rebuild_product_card", result_status: "applied", product_id: productId,
    before_card_quantity: 2, before_movement_quantity: 1, before_movement_book_value: 130,
    proposed_card_quantity: 1, after_card_quantity: 1,
    after_movement_quantity: 1, after_movement_book_value: 130,
  }, "بند المعالجة");
  same(verification.events, {
    count: 4, types: ["created", "submitted", "approved", "executed"], unique_requests: 4,
  }, "سجل الأحداث");
  same(verification.effect, {
    count: 1, effect_type: "product_card_rebuilt", table_name: "products", record_id: productId,
    before_data: { card_quantity: 2, movement_quantity: 1, movement_book_value: 130 },
    after_data: { card_quantity: 1, movement_quantity: 1, movement_book_value: 130 },
  }, "أثر التنفيذ");
  same(verification.product, {
    count: 1, code: productCode, name: "قميص قصير زبدة", purchase_price: 130,
    selling_price: 200, quantity_on_hand: 1, min_stock_level: 3, is_active: true,
    brand_id: "066284be-4582-40a3-ba10-d268dd0e78cd",
    category_id: "63c712e9-3091-466c-995d-ece73e6693d2",
    unit_id: "4ca8f363-5eb9-47cb-aaca-f89b6f08b28e", model_number: "115",
    barcode: "554200001850", barcode_label: "قميص قصير بياتريس - 115", barcode_price: 235,
  }, "بطاقة المنتج");
  same(verification.target_movements, { count: 2, signed_quantity: 1, book_value: 130 }, "حركات المنتج");
  same({
    classification: verification.diagnostic?.classification,
    card_quantity: verification.diagnostic?.card_quantity,
    movement_quantity: verification.diagnostic?.movement_quantity,
    quantity_difference: verification.diagnostic?.quantity_difference,
  }, { classification: "matched", card_quantity: 1, movement_quantity: 1, quantity_difference: 0 }, "التشخيص اللاحق");
  if (!/^[0-9a-f]{32}$/.test(verification.global_fingerprint)
      || verification.global_fingerprint === expectedFingerprint) {
    throw new Error(`فشل تحقق تجدد بصمة التشخيص: ${verification.global_fingerprint}`);
  }
  same(verification.global_quantity_difference, 0, "إجمالي فرق الكمية");
  same(verification.counts, {
    products: 613, inventory_movements: 1354, journal_entries: 310,
    journal_entry_lines: 827, repairs: 2, repair_items: 2, repair_effects: 1, repair_events: 8,
  }, "الأعداد");
  same(verification.immutable_signatures, {
    inventory_movements: "385b3023955d3d47a92fc76111ba6061",
    sales_invoices: "c1ff2343b40738e2c52f16d7dcabb6e0",
    purchase_invoices: "7ef53a222c8ead5f686b57ff465d41bf",
    journal_entries: "dced89b13d5cfd250ec5b761dca48df4",
    journal_entry_lines: "590a65ddd81a73aad1c93ce0e787665a",
  }, "بصمات بيانات الأعمال غير المسموح بتغييرها");

  writeFileSync(reportPath, `${JSON.stringify({
    ...verification,
    verifiedAt: new Date().toISOString(), projectRef: expectedProjectRef,
    readOnly: true, productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجح تحقق تنفيذ IR-0012: عادت البطاقة إلى الحركات دون تغيير حركة أو قيد أو تكلفة");
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
