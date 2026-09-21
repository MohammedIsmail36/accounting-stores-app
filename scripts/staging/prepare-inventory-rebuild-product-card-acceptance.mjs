// Controlled Staging-only mismatch for the stage-2C UI acceptance test.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const cli = "supabase@2.116.0";
const productId = "2e364454-c894-48f4-bb47-1389ee723336";
const productCode = "PRD-002";
const expectedFingerprint = "9b453def7dde286953493f04b52b89e3";
const beforeQuantity = 1;
const testQuantity = 2;

export function validateAcceptanceFixtureSource(source) {
  for (const required of [
    expectedProjectRef,
    productId,
    productCode,
    expectedFingerprint,
    "STAGING_REBUILD_ACCEPTANCE_MISMATCH_READY",
    "STAGING_REBUILD_ACCEPTANCE_ROLLBACK_OK",
    "BEGIN;",
    "COMMIT;",
    "REPAIR_PRECONDITION_CHANGED",
  ]) {
    if (!source.includes(required)) throw new Error(`حاجز حالة قبول 2C مفقود: ${required}`);
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

function runCli(sql, label) {
  const reportDir = mkdtempSync(`/tmp/accounting-staging-rebuild-acceptance-${label}-`);
  const sqlPath = join(reportDir, `${label}.sql`);
  const logPath = join(reportDir, "run.log");
  const reportPath = join(reportDir, "report.json");
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  const result = spawnSync("npx", [
    "-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", sqlPath,
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    writeFileSync(logPath, output, { mode: 0o600 });
    throw new Error(`فشلت خطوة ${label} لحالة قبول 2C؛ التشخيص المحمي: ${logPath}`);
  }
  const parsed = JSON.parse(result.stdout);
  const verification = parsed.rows?.find((row) => row.result)?.result;
  if (!verification) throw new Error(`لم تعد خطوة ${label} نتيجة تحقق`);
  writeFileSync(reportPath, `${JSON.stringify({
    ...verification,
    verifiedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    productId,
    productCode,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });
  return { verification, reportDir };
}

const diagnosticRowSql = `(SELECT value
  FROM jsonb_array_elements(public.get_inventory_reconciliation_diagnostic(
    'products', false, '${productCode}', 500, 0, NULL
  )->'rows')
  WHERE value->>'product_id' = '${productId}'
  LIMIT 1)`;

function applySql() {
  return `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $preflight$
DECLARE v_row jsonb; v_fingerprint text;
BEGIN
  IF current_database() <> 'postgres'
     OR current_setting('server_version') <> '17.6'
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260914190000')
     OR position('product_card_rebuilt' IN pg_get_functiondef(
       'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
     )) = 0 THEN
    RAISE EXCEPTION 'STAGING_REBUILD_ACCEPTANCE_ENVIRONMENT_INVALID';
  END IF;
  v_fingerprint := public.get_inventory_reconciliation_diagnostic(
    'summary', true, NULL, 100, 0, NULL
  )->>'fingerprint';
  IF v_fingerprint IS DISTINCT FROM '${expectedFingerprint}' THEN
    RAISE EXCEPTION 'REPAIR_PRECONDITION_CHANGED';
  END IF;
  v_row := ${diagnosticRowSql};
  IF v_row IS NULL
     OR v_row->>'classification' <> 'matched'
     OR (v_row->>'card_quantity')::numeric <> ${beforeQuantity}
     OR (v_row->>'movement_quantity')::numeric <> ${beforeQuantity}
     OR (v_row->>'movement_book_value')::numeric <> 130
     OR (v_row->>'movement_count')::integer <> 2
     OR NOT COALESCE((v_row->>'can_prepare_repair')::boolean, false)
     OR EXISTS (
       SELECT 1 FROM public.inventory_reconciliation_repair_items
       WHERE product_id = '${productId}'::uuid
     ) THEN
    RAISE EXCEPTION 'REPAIR_PRECONDITION_CHANGED';
  END IF;
END;
$preflight$;

UPDATE public.products
SET quantity_on_hand = ${testQuantity}
WHERE id = '${productId}'::uuid
  AND code = '${productCode}'
  AND quantity_on_hand = ${beforeQuantity};

DO $postcheck$
DECLARE v_row jsonb;
BEGIN
  v_row := ${diagnosticRowSql};
  IF v_row IS NULL
     OR v_row->>'classification' <> 'product_balance'
     OR (v_row->>'card_quantity')::numeric <> ${testQuantity}
     OR (v_row->>'movement_quantity')::numeric <> ${beforeQuantity}
     OR (v_row->>'quantity_difference')::numeric <> 1
     OR NOT COALESCE((v_row->>'can_prepare_repair')::boolean, false) THEN
    RAISE EXCEPTION 'STAGING_REBUILD_ACCEPTANCE_POSTCHECK_FAILED';
  END IF;
END;
$postcheck$;

SELECT jsonb_build_object(
  'result', 'STAGING_REBUILD_ACCEPTANCE_MISMATCH_READY',
  'before_card_quantity', ${beforeQuantity},
  'test_card_quantity', ${testQuantity},
  'movement_quantity', ${beforeQuantity},
  'diagnostic_classification', (${diagnosticRowSql})->>'classification'
) AS result;
COMMIT;
`;
}

function rollbackSql() {
  return `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $guard$
DECLARE v_row jsonb;
BEGIN
  IF current_database() <> 'postgres'
     OR current_setting('server_version') <> '17.6'
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260914190000') THEN
    RAISE EXCEPTION 'STAGING_REBUILD_ACCEPTANCE_ROLLBACK_ENVIRONMENT_INVALID';
  END IF;
  v_row := ${diagnosticRowSql};
  IF v_row IS NULL
     OR v_row->>'classification' <> 'product_balance'
     OR (v_row->>'card_quantity')::numeric <> ${testQuantity}
     OR (v_row->>'movement_quantity')::numeric <> ${beforeQuantity}
     OR (v_row->>'movement_book_value')::numeric <> 130
     OR (v_row->>'movement_count')::integer <> 2
     OR EXISTS (
       SELECT 1
       FROM public.inventory_reconciliation_repair_effects e
       WHERE e.table_name = 'products'
         AND e.record_id = '${productId}'::uuid
         AND e.effect_type = 'product_card_rebuilt'
     ) THEN
    RAISE EXCEPTION 'REPAIR_PRECONDITION_CHANGED';
  END IF;
END;
$guard$;

UPDATE public.products
SET quantity_on_hand = ${beforeQuantity}
WHERE id = '${productId}'::uuid
  AND code = '${productCode}'
  AND quantity_on_hand = ${testQuantity};

DO $postcheck$
DECLARE v_row jsonb;
BEGIN
  v_row := ${diagnosticRowSql};
  IF v_row IS NULL OR v_row->>'classification' <> 'matched'
     OR (v_row->>'card_quantity')::numeric <> ${beforeQuantity}
     OR (v_row->>'movement_quantity')::numeric <> ${beforeQuantity} THEN
    RAISE EXCEPTION 'STAGING_REBUILD_ACCEPTANCE_ROLLBACK_POSTCHECK_FAILED';
  END IF;
END;
$postcheck$;

SELECT jsonb_build_object(
  'result', 'STAGING_REBUILD_ACCEPTANCE_ROLLBACK_OK',
  'restored_card_quantity', ${beforeQuantity},
  'movement_quantity', ${beforeQuantity},
  'diagnostic_classification', (${diagnosticRowSql})->>'classification'
) AS result;
COMMIT;
`;
}

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--apply", "--rollback"].includes(mode) || process.argv.length > 3) {
    throw new Error("استخدم --check أو --apply أو --rollback");
  }
  validateAcceptanceFixtureSource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  const linkedRef = readFileSync(projectRefPath, "utf8").trim();
  if (linkedRef !== expectedProjectRef) {
    throw new Error(`رفض التنفيذ: المشروع المرتبط ${linkedRef || "غير موجود"} ليس Staging المعتمد`);
  }
  if (mode === "--check") {
    console.log("حالة قبول 2C وخطة الرجوع جاهزتان ومقيدتان بـStaging");
    return;
  }
  const { verification, reportDir } = runCli(mode === "--apply" ? applySql() : rollbackSql(), mode.slice(2));
  const expectedResult = mode === "--apply"
    ? "STAGING_REBUILD_ACCEPTANCE_MISMATCH_READY"
    : "STAGING_REBUILD_ACCEPTANCE_ROLLBACK_OK";
  if (verification.result !== expectedResult) throw new Error("علامة نتيجة حالة القبول غير صحيحة");
  console.log(mode === "--apply"
    ? "تم إعداد فرق رصيد المنتج المضبوط على Staging والتحقق منه"
    : "تم الرجوع عن فرق رصيد المنتج المضبوط والتحقق من عودة التطابق");
  console.log(`PRODUCT=${productCode}`);
  console.log(`CARD=${verification.test_card_quantity ?? verification.restored_card_quantity} MOVEMENTS=${verification.movement_quantity}`);
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
