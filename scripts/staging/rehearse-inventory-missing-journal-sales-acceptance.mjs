// Controlled Staging-only sales-invoice rehearsal for stage-2D acceptance.
import { isDeepStrictEqual } from "node:util";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baselineSql } from "./backup-inventory-missing-journal-ui-bridge-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const cli = "supabase@2.116.0";
const fixture = {
  productId: "2d2d0000-0000-4000-8000-000000000201",
  invoiceId: "2d2d0000-0000-4000-8000-000000000202",
  itemId: "2d2d0000-0000-4000-8000-000000000203",
  movementId: "2d2d0000-0000-4000-8000-000000000204",
  productCode: "TST-2D-SI-001",
  invoiceNumber: 990022,
};

function assertStagingLink() {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }
}

function runCli(sql, label, reportDir) {
  assertStagingLink();
  const sqlPath = join(reportDir, `${label}.sql`);
  const logPath = join(reportDir, `${label}.log`);
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  const result = spawnSync("npx", [
    "-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", sqlPath,
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}`, { mode: 0o600 });
    throw new Error(`فشلت خطوة ${label} لتجربة بيع 2D؛ التشخيص المحمي: ${logPath}`);
  }
  return JSON.parse(result.stdout);
}

function normalizeBaseline(value) {
  const normalized = structuredClone(value);
  if (normalized?.diagnostic) delete normalized.diagnostic.snapshot_at;
  return normalized;
}

const environmentGuard = `
DO $environment_guard$
BEGIN
  IF current_database() <> 'postgres'
     OR current_setting('server_version') NOT LIKE '17.%'
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921213000')
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921220000')
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921233000')
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260922070000')
     OR to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NULL
     OR to_regprocedure('public.execute_inventory_reconciliation_repair(uuid,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'STAGING_2D_SALES_REHEARSAL_ENVIRONMENT_INVALID';
  END IF;
END;
$environment_guard$;
`;

const absenceGuard = `
DO $absence_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE id = '${fixture.productId}' OR code = '${fixture.productCode}')
     OR EXISTS (SELECT 1 FROM public.sales_invoices WHERE id = '${fixture.invoiceId}' OR invoice_number = ${fixture.invoiceNumber})
     OR EXISTS (SELECT 1 FROM public.sales_invoice_items WHERE id = '${fixture.itemId}')
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE id = '${fixture.movementId}')
     OR EXISTS (
       SELECT 1 FROM public.inventory_reconciliation_repair_items
       WHERE source_type = 'sales_invoice' AND source_id = '${fixture.invoiceId}'::uuid
     ) THEN
    RAISE EXCEPTION 'STAGING_2D_SALES_REHEARSAL_FIXTURE_ALREADY_EXISTS';
  END IF;
END;
$absence_guard$;
`;

const insertFixture = `
INSERT INTO public.products(
  id, code, name, purchase_price, selling_price, quantity_on_hand, min_stock_level, is_active
) VALUES (
  '${fixture.productId}'::uuid, '${fixture.productCode}',
  'منتج تجربة قبول 2D — فاتورة بيع بلا قيد', 40, 50, 8, 0, true
);

INSERT INTO public.sales_invoices(
  id, invoice_number, invoice_date, status, subtotal, discount, tax, total,
  paid_amount, notes, journal_entry_id
) VALUES (
  '${fixture.invoiceId}'::uuid, ${fixture.invoiceNumber}, current_date, 'posted',
  100, 0, 0, 100, 0, '__2D_SALES_REHEARSAL_WITHOUT_JOURNAL__', NULL
);

INSERT INTO public.sales_invoice_items(
  id, invoice_id, product_id, description, quantity, unit_price, discount, total
) VALUES (
  '${fixture.itemId}'::uuid, '${fixture.invoiceId}'::uuid, '${fixture.productId}'::uuid,
  'بند تجربة قبول بيع 2D', 2, 50, 0, 100
);

INSERT INTO public.inventory_movements(
  id, product_id, movement_type, quantity, unit_cost, total_cost,
  reference_id, reference_type, notes, movement_date
) VALUES (
  '${fixture.movementId}'::uuid, '${fixture.productId}'::uuid, 'sale', 2, 40, 80,
  '${fixture.invoiceId}'::uuid, 'sales_invoice', '__2D_SALES_REHEARSAL__', current_date
);
`;

const verifyFixture = `
DO $fixture_verification$
DECLARE
  v_row jsonb;
  v_plan jsonb;
  v_debit numeric;
  v_credit numeric;
BEGIN
  SELECT value INTO v_row
  FROM jsonb_array_elements(public.get_inventory_reconciliation_diagnostic(
    'sources', true, '${fixture.invoiceId}', 500, 0, NULL
  )->'rows')
  WHERE value->>'source_type' = 'sales_invoice'
    AND value->>'source_id' = '${fixture.invoiceId}'
  LIMIT 1;

  IF v_row IS NULL
     OR v_row->>'classification' <> 'movement_without_journal'
     OR (v_row->>'movement_count')::integer <> 1
     OR round((v_row->>'movement_book_value')::numeric, 2) <> -80 THEN
    RAISE EXCEPTION 'STAGING_2D_SALES_REHEARSAL_DIAGNOSTIC_INVALID: %', v_row;
  END IF;

  v_plan := public.get_inventory_reconciliation_journal_plan(
    'sales_invoice', '${fixture.invoiceId}'::uuid, NULL
  );
  SELECT round(COALESCE(sum((line->>'debit')::numeric), 0), 2),
         round(COALESCE(sum((line->>'credit')::numeric), 0), 2)
  INTO v_debit, v_credit
  FROM jsonb_array_elements(v_plan->'correction_lines') line;

  IF COALESCE((v_plan->>'eligible')::boolean, false) IS NOT TRUE
     OR v_plan->>'reason_code' <> 'READY'
     OR v_plan->>'mode' <> 'create_full_journal'
     OR v_plan->>'source_number' <> '${fixture.invoiceNumber}'
     OR round((v_plan->>'movement_book_value')::numeric, 2) <> -80
     OR v_debit <> 180 OR v_credit <> 180
     OR jsonb_array_length(v_plan->'correction_lines') <> 4
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') line
       WHERE line->>'account_code' = '1103'
         AND (line->>'debit')::numeric = 100 AND (line->>'credit')::numeric = 0
     )
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') line
       WHERE line->>'account_code' = '4101'
         AND (line->>'debit')::numeric = 0 AND (line->>'credit')::numeric = 100
     )
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') line
       WHERE line->>'account_code' = '5101'
         AND (line->>'debit')::numeric = 80 AND (line->>'credit')::numeric = 0
     )
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') line
       WHERE line->>'account_code' = '1104'
         AND (line->>'debit')::numeric = 0 AND (line->>'credit')::numeric = 80
     ) THEN
    RAISE EXCEPTION 'STAGING_2D_SALES_REHEARSAL_PLAN_INVALID: %', v_plan;
  END IF;
END;
$fixture_verification$;
`;

const explicitRollback = `
DO $rollback_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sales_invoices
    WHERE id = '${fixture.invoiceId}'::uuid
      AND invoice_number = ${fixture.invoiceNumber}
      AND notes = '__2D_SALES_REHEARSAL_WITHOUT_JOURNAL__'
      AND journal_entry_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.inventory_reconciliation_repair_items
    WHERE source_type = 'sales_invoice' AND source_id = '${fixture.invoiceId}'::uuid
  ) THEN
    RAISE EXCEPTION 'STAGING_2D_SALES_REHEARSAL_ROLLBACK_REFUSED';
  END IF;
END;
$rollback_guard$;

DELETE FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid;
DELETE FROM public.sales_invoice_items WHERE id = '${fixture.itemId}'::uuid;
DELETE FROM public.sales_invoices WHERE id = '${fixture.invoiceId}'::uuid;
DELETE FROM public.products WHERE id = '${fixture.productId}'::uuid;

DO $rollback_postcheck$
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE id = '${fixture.productId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.sales_invoices WHERE id = '${fixture.invoiceId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.sales_invoice_items WHERE id = '${fixture.itemId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid) THEN
    RAISE EXCEPTION 'STAGING_2D_SALES_REHEARSAL_ROLLBACK_POSTCHECK_FAILED';
  END IF;
END;
$rollback_postcheck$;
`;

function rehearsalSql() {
  return `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
${environmentGuard}
${absenceGuard}
${insertFixture}
${verifyFixture}
${explicitRollback}
SELECT jsonb_build_object(
  'result', 'STAGING_2D_SALES_FIXTURE_REHEARSAL_OK',
  'source_type', 'sales_invoice',
  'source_id', '${fixture.invoiceId}',
  'invoice_number', ${fixture.invoiceNumber},
  'expected_accounts', jsonb_build_array('1103', '4101', '5101', '1104'),
  'rollback_tested', true
) AS result;
ROLLBACK;
`;
}

function main() {
  if (process.argv.length > 2) {
    throw new Error("هذا المشغّل ينفذ تجربة ROLLBACK فقط ولا يقبل معاملات");
  }
  assertStagingLink();
  const reportDir = mkdtempSync("/tmp/accounting-staging-2d-sales-rehearsal-");
  chmodSync(reportDir, 0o700);
  writeFileSync(join(reportDir, "explicit-rollback.sql"), `BEGIN;\n${explicitRollback}\nCOMMIT;\n`, { mode: 0o600 });

  const before = runCli(baselineSql, "baseline-before", reportDir).rows?.[0]?.baseline;
  const output = runCli(rehearsalSql(), "sales-rehearsal", reportDir);
  const result = output.rows?.find((row) => row.result)?.result;
  if (result?.result !== "STAGING_2D_SALES_FIXTURE_REHEARSAL_OK") {
    throw new Error("لم تعد تجربة البيع علامة النجاح المتوقعة");
  }
  const after = runCli(baselineSql, "baseline-after", reportDir).rows?.[0]?.baseline;
  if (!isDeepStrictEqual(normalizeBaseline(after), normalizeBaseline(before))) {
    writeFileSync(join(reportDir, "baseline-mismatch.json"), `${JSON.stringify({ before, after }, null, 2)}\n`, { mode: 0o600 });
    throw new Error(`لم يعد خط أساس Staging بعد التجربة؛ التشخيص المحمي: ${reportDir}`);
  }

  writeFileSync(join(reportDir, "report.json"), `${JSON.stringify({
    ...result,
    projectRef: expectedProjectRef,
    baselineRestored: true,
    productionModified: false,
    verifiedAt: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجحت تجربة فاتورة البيع 2D داخل معاملة انتهت بـROLLBACK كامل");
  console.log("تطابقت خطة 1103/4101 و5101/1104 وعاد خط أساس Staging بالكامل");
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
