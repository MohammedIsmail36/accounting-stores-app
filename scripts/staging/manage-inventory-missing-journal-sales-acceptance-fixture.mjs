// Controlled Staging-only sales fixture for the stage-2D UI acceptance test.
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
const baselineDir = "/tmp/staging-inventory-missing-journal-ui-acceptance-before-20260923-014135";
const cli = "supabase@2.116.0";
const fixture = {
  productId: "2d2d0000-0000-4000-8000-000000000201",
  invoiceId: "2d2d0000-0000-4000-8000-000000000202",
  itemId: "2d2d0000-0000-4000-8000-000000000203",
  saleMovementId: "2d2d0000-0000-4000-8000-000000000204",
  openingMovementId: "2d2d0000-0000-4000-8000-000000000205",
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
    throw new Error(`فشلت خطوة ${label} لحالة قبول بيع 2D؛ التشخيص المحمي: ${logPath}`);
  }
  return JSON.parse(result.stdout);
}

function queryBaseline(label, reportDir) {
  return runCli(baselineSql, label, reportDir).rows?.[0]?.baseline;
}

function normalizeBaseline(value) {
  const normalized = structuredClone(value);
  if (normalized?.diagnostic) delete normalized.diagnostic.snapshot_at;
  return normalized;
}

function assertBaseline(actual, expected, label, reportDir) {
  if (!isDeepStrictEqual(normalizeBaseline(actual), normalizeBaseline(expected))) {
    writeFileSync(join(reportDir, "baseline-mismatch.json"), `${JSON.stringify({ label, expected, actual }, null, 2)}\n`, { mode: 0o600 });
    throw new Error(`تغير خط أساس Staging في مرحلة ${label}؛ أُلغي الإجراء`);
  }
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
    RAISE EXCEPTION 'STAGING_2D_SALES_ACCEPTANCE_ENVIRONMENT_INVALID';
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
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE id IN ('${fixture.saleMovementId}'::uuid, '${fixture.openingMovementId}'::uuid))
     OR EXISTS (
       SELECT 1 FROM public.inventory_reconciliation_repair_items
       WHERE source_type = 'sales_invoice' AND source_id = '${fixture.invoiceId}'::uuid
     ) THEN
    RAISE EXCEPTION 'STAGING_2D_SALES_ACCEPTANCE_FIXTURE_ALREADY_EXISTS';
  END IF;
END;
$absence_guard$;
`;

const insertFixture = `
INSERT INTO public.products(
  id, code, name, purchase_price, selling_price, quantity_on_hand, min_stock_level, is_active
) VALUES (
  '${fixture.productId}'::uuid, '${fixture.productCode}',
  'منتج اختبار قبول 2D — فاتورة بيع بلا قيد', 40, 50, 8, 0, true
);

DO $opening_seed$
DECLARE
  v_inventory uuid;
  v_equity uuid;
  v_opening_journal uuid;
BEGIN
  SELECT id INTO STRICT v_inventory FROM public.accounts WHERE code = '1104';
  SELECT id INTO STRICT v_equity FROM public.accounts WHERE code = '3101';
  v_opening_journal := public.create_journal_entry(
    current_date,
    '__2D_SALES_ACCEPTANCE_OPENING__',
    jsonb_build_array(
      jsonb_build_object('account_id', v_inventory, 'debit', 400, 'credit', 0,
        'description', 'رصيد افتتاحي لمنتج اختبار قبول بيع 2D'),
      jsonb_build_object('account_id', v_equity, 'debit', 0, 'credit', 400,
        'description', 'مقابل رصيد افتتاحي لمنتج اختبار قبول بيع 2D')
    ),
    'posted', NULL, 'regular'
  );

  INSERT INTO public.inventory_movements(
    id, product_id, movement_type, quantity, unit_cost, total_cost,
    reference_id, reference_type, notes, movement_date
  ) VALUES (
    '${fixture.openingMovementId}'::uuid, '${fixture.productId}'::uuid,
    'opening_balance', 10, 40, 400, v_opening_journal, 'staging_seed',
    '__2D_SALES_ACCEPTANCE_OPENING__', current_date
  );
END;
$opening_seed$;

INSERT INTO public.sales_invoices(
  id, invoice_number, invoice_date, status, subtotal, discount, tax, total,
  paid_amount, notes, journal_entry_id
) VALUES (
  '${fixture.invoiceId}'::uuid, ${fixture.invoiceNumber}, current_date, 'posted',
  100, 0, 0, 100, 0, '__2D_UI_ACCEPTANCE_SALES_WITHOUT_JOURNAL__', NULL
);

INSERT INTO public.sales_invoice_items(
  id, invoice_id, product_id, description, quantity, unit_price, discount, total
) VALUES (
  '${fixture.itemId}'::uuid, '${fixture.invoiceId}'::uuid, '${fixture.productId}'::uuid,
  'بند اختبار قبول بيع 2D', 2, 50, 0, 100
);

INSERT INTO public.inventory_movements(
  id, product_id, movement_type, quantity, unit_cost, total_cost,
  reference_id, reference_type, notes, movement_date
) VALUES (
  '${fixture.saleMovementId}'::uuid, '${fixture.productId}'::uuid, 'sale', 2, 40, 80,
  '${fixture.invoiceId}'::uuid, 'sales_invoice', '__2D_UI_ACCEPTANCE_SALES__', current_date
);
`;

const verifyFixture = `
DO $fixture_verification$
DECLARE
  v_row jsonb;
  v_opening_row jsonb;
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

  SELECT value INTO v_opening_row
  FROM jsonb_array_elements(public.get_inventory_reconciliation_diagnostic(
    'sources', false, NULL, 500, 0, NULL
  )->'rows')
  WHERE value->>'source_type' = 'staging_seed'
    AND value->>'source_id' = (
      SELECT reference_id::text FROM public.inventory_movements
      WHERE id = '${fixture.openingMovementId}'::uuid
    )
  LIMIT 1;

  IF v_row IS NULL
     OR v_row->>'classification' <> 'movement_without_journal'
     OR (v_row->>'movement_count')::integer <> 1
     OR round((v_row->>'movement_book_value')::numeric, 2) <> -80
     OR v_opening_row IS NULL
     OR v_opening_row->>'classification' <> 'matched'
     OR round((v_opening_row->>'movement_book_value')::numeric, 2) <> 400
     OR round((v_opening_row->>'ledger_1104_value')::numeric, 2) <> 400
     OR (SELECT quantity_on_hand FROM public.products WHERE id = '${fixture.productId}'::uuid) <> 8
     OR (SELECT sum(public.inventory_signed_quantity(movement_type::text, quantity))
         FROM public.inventory_movements WHERE product_id = '${fixture.productId}'::uuid) <> 8 THEN
    RAISE EXCEPTION 'STAGING_2D_SALES_ACCEPTANCE_DIAGNOSTIC_INVALID: source=%, opening=%', v_row, v_opening_row;
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
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') l WHERE l->>'account_code' = '1103' AND (l->>'debit')::numeric = 100 AND (l->>'credit')::numeric = 0)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') l WHERE l->>'account_code' = '4101' AND (l->>'debit')::numeric = 0 AND (l->>'credit')::numeric = 100)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') l WHERE l->>'account_code' = '5101' AND (l->>'debit')::numeric = 80 AND (l->>'credit')::numeric = 0)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') l WHERE l->>'account_code' = '1104' AND (l->>'debit')::numeric = 0 AND (l->>'credit')::numeric = 80) THEN
    RAISE EXCEPTION 'STAGING_2D_SALES_ACCEPTANCE_PLAN_INVALID: %', v_plan;
  END IF;
END;
$fixture_verification$;
`;

const rollbackFixture = `
DO $rollback_fixture$
DECLARE
  v_opening_journal uuid;
BEGIN
  SELECT reference_id INTO v_opening_journal
  FROM public.inventory_movements
  WHERE id = '${fixture.openingMovementId}'::uuid
    AND reference_type = 'staging_seed';

  IF v_opening_journal IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.journal_entries
       WHERE id = v_opening_journal
         AND description = '__2D_SALES_ACCEPTANCE_OPENING__'
         AND status = 'posted'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.sales_invoices
       WHERE id = '${fixture.invoiceId}'::uuid
         AND invoice_number = ${fixture.invoiceNumber}
         AND notes = '__2D_UI_ACCEPTANCE_SALES_WITHOUT_JOURNAL__'
         AND journal_entry_id IS NULL
     )
     OR EXISTS (
       SELECT 1 FROM public.inventory_reconciliation_repair_items
       WHERE source_type = 'sales_invoice' AND source_id = '${fixture.invoiceId}'::uuid
     ) THEN
    RAISE EXCEPTION 'STAGING_2D_SALES_ACCEPTANCE_ROLLBACK_REFUSED';
  END IF;

  DELETE FROM public.inventory_movements WHERE id IN ('${fixture.saleMovementId}'::uuid, '${fixture.openingMovementId}'::uuid);
  DELETE FROM public.sales_invoice_items WHERE id = '${fixture.itemId}'::uuid;
  DELETE FROM public.sales_invoices WHERE id = '${fixture.invoiceId}'::uuid;
  DELETE FROM public.products WHERE id = '${fixture.productId}'::uuid;
  DELETE FROM public.journal_entry_lines WHERE journal_entry_id = v_opening_journal;
  DELETE FROM public.journal_entries WHERE id = v_opening_journal;
END;
$rollback_fixture$;

DO $rollback_postcheck$
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE id = '${fixture.productId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.sales_invoices WHERE id = '${fixture.invoiceId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.sales_invoice_items WHERE id = '${fixture.itemId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE id IN ('${fixture.saleMovementId}'::uuid, '${fixture.openingMovementId}'::uuid))
     OR EXISTS (SELECT 1 FROM public.journal_entries WHERE description = '__2D_SALES_ACCEPTANCE_OPENING__') THEN
    RAISE EXCEPTION 'STAGING_2D_SALES_ACCEPTANCE_ROLLBACK_POSTCHECK_FAILED';
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
${rollbackFixture}
SELECT jsonb_build_object('result', 'STAGING_2D_SALES_ACCEPTANCE_REHEARSAL_OK', 'rollback_tested', true) AS result;
ROLLBACK;
`;
}

function applySql() {
  return `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
${environmentGuard}
${absenceGuard}
${insertFixture}
${verifyFixture}
SELECT jsonb_build_object(
  'result', 'STAGING_2D_SALES_ACCEPTANCE_READY',
  'source_type', 'sales_invoice',
  'source_id', '${fixture.invoiceId}',
  'invoice_number', ${fixture.invoiceNumber},
  'product_code', '${fixture.productCode}'
) AS result;
COMMIT;
`;
}

function rollbackSql() {
  return `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
${environmentGuard}
${rollbackFixture}
SELECT jsonb_build_object('result', 'STAGING_2D_SALES_ACCEPTANCE_ROLLBACK_OK') AS result;
COMMIT;
`;
}

function assertAppliedBaseline(actual, expected) {
  const countDeltas = {
    products: 1,
    inventory_movements: 2,
    sales_invoices: 1,
    journal_entries: 1,
    journal_entry_lines: 2,
    repairs: 0,
    repair_items: 0,
    repair_effects: 0,
    repair_events: 0,
  };
  for (const [key, delta] of Object.entries(countDeltas)) {
    if (actual.counts[key] !== expected.counts[key] + delta) {
      throw new Error(`الزيادة بعد إعداد حالة البيع غير صحيحة في ${key}`);
    }
  }
  if (actual.bridge_state.active_repairs !== 0
      || actual.diagnostic.issue_counts.products !== expected.diagnostic.issue_counts.products
      || actual.diagnostic.issue_counts.unlinked_journals !== expected.diagnostic.issue_counts.unlinked_journals
      || actual.diagnostic.issue_counts.unlinked_movements !== expected.diagnostic.issue_counts.unlinked_movements
      || actual.diagnostic.issue_counts.sources !== expected.diagnostic.issue_counts.sources + 1) {
    throw new Error("تشخيص Staging بعد إعداد حالة البيع لا يطابق الأثر المضبوط");
  }
}

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--rehearse", "--apply", "--rollback"].includes(mode) || process.argv.length > 3) {
    throw new Error("استخدم --check أو --rehearse أو --apply أو --rollback");
  }
  assertStagingLink();
  const expectedBaseline = JSON.parse(readFileSync(join(baselineDir, "baseline.json"), "utf8"));
  const reportDir = mkdtempSync(`/tmp/accounting-staging-2d-sales-acceptance-${mode.slice(2)}-`);
  chmodSync(reportDir, 0o700);
  writeFileSync(join(reportDir, "explicit-rollback.sql"), rollbackSql(), { mode: 0o600 });

  if (mode === "--check") {
    console.log("حالة قبول فاتورة البيع 2D وخطة رجوعها جاهزتان ومقيدتان بـStaging");
    console.log(`REPORT_DIR=${reportDir}`);
    return;
  }

  const before = queryBaseline("baseline-before", reportDir);
  if (mode !== "--rollback") assertBaseline(before, expectedBaseline, "ما قبل الحالة", reportDir);
  const sql = mode === "--rehearse" ? rehearsalSql() : mode === "--apply" ? applySql() : rollbackSql();
  const output = runCli(sql, mode.slice(2), reportDir);
  const result = output.rows?.find((row) => row.result)?.result;
  if (!result?.result) throw new Error("لم تعد عملية حالة البيع علامة تحقق");

  const after = queryBaseline("baseline-after", reportDir);
  if (mode === "--rehearse" || mode === "--rollback") {
    assertBaseline(after, expectedBaseline, "ما بعد الرجوع", reportDir);
  } else {
    assertAppliedBaseline(after, expectedBaseline);
  }

  writeFileSync(join(reportDir, "report.json"), `${JSON.stringify({
    ...result,
    mode,
    projectRef: expectedProjectRef,
    baselineRestored: mode !== "--apply",
    productionModified: false,
    verifiedAt: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 });
  console.log(mode === "--rehearse"
    ? "نجحت تجربة إعداد حالة فاتورة البيع 2D والرجوع داخل معاملة انتهت بـROLLBACK كامل"
    : mode === "--apply"
      ? "تم إعداد حالة فاتورة البيع 2D على Staging والتحقق من اتساق المنتج والرصيد الافتتاحي"
      : "تم الرجوع عن حالة فاتورة البيع 2D وعاد خط الأساس بالكامل");
  console.log(`SOURCE=sales_invoice:${fixture.invoiceNumber}`);
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
