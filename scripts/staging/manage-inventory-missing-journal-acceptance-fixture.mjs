// Controlled Staging-only purchase fixture for the stage-2D UI acceptance test.
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
const baselineDir = "/tmp/staging-inventory-missing-journal-ui-acceptance-before-20260922-114237";
const cli = "supabase@2.116.0";
const fixture = {
  productId: "2d2d0000-0000-4000-8000-000000000101",
  invoiceId: "2d2d0000-0000-4000-8000-000000000102",
  itemId: "2d2d0000-0000-4000-8000-000000000103",
  movementId: "2d2d0000-0000-4000-8000-000000000104",
  productCode: "TST-2D-PI-001",
  invoiceNumber: 990021,
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
    throw new Error(`فشلت خطوة ${label} لحالة قبول 2D؛ التشخيص المحمي: ${logPath}`);
  }
  return JSON.parse(result.stdout);
}

function queryCurrentBaseline(label, reportDir) {
  return runCli(baselineSql, label, reportDir).rows?.[0]?.baseline;
}

function normalizeBaseline(value) {
  const normalized = structuredClone(value);
  if (normalized?.diagnostic) delete normalized.diagnostic.snapshot_at;
  return normalized;
}

function assertBaseline(actual, expected, label, reportDir) {
  if (!isDeepStrictEqual(normalizeBaseline(actual), normalizeBaseline(expected))) {
    writeFileSync(join(reportDir, "baseline-mismatch.json"), `${JSON.stringify({
      label,
      expected,
      actual,
    }, null, 2)}\n`, { mode: 0o600 });
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
    RAISE EXCEPTION 'STAGING_2D_ACCEPTANCE_ENVIRONMENT_INVALID';
  END IF;
END;
$environment_guard$;
`;

const absenceGuard = `
DO $absence_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE id = '${fixture.productId}' OR code = '${fixture.productCode}')
     OR EXISTS (SELECT 1 FROM public.purchase_invoices WHERE id = '${fixture.invoiceId}' OR invoice_number = ${fixture.invoiceNumber})
     OR EXISTS (SELECT 1 FROM public.purchase_invoice_items WHERE id = '${fixture.itemId}')
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE id = '${fixture.movementId}') THEN
    RAISE EXCEPTION 'STAGING_2D_ACCEPTANCE_FIXTURE_ALREADY_EXISTS';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.inventory_reconciliation_repair_items i
    JOIN public.inventory_reconciliation_repairs r ON r.id = i.repair_id
    WHERE i.source_type = 'purchase_invoice'
      AND i.source_id = '${fixture.invoiceId}'::uuid
  ) THEN
    RAISE EXCEPTION 'STAGING_2D_ACCEPTANCE_REPAIR_ALREADY_EXISTS';
  END IF;
END;
$absence_guard$;
`;

const insertFixture = `
INSERT INTO public.products(
  id, code, name, purchase_price, selling_price, quantity_on_hand, min_stock_level, is_active
) VALUES (
  '${fixture.productId}'::uuid, '${fixture.productCode}',
  'منتج اختبار قبول 2D — فاتورة شراء بلا قيد', 50, 75, 2, 0, true
);

INSERT INTO public.purchase_invoices(
  id, invoice_number, invoice_date, status, subtotal, discount, tax, total,
  paid_amount, notes, journal_entry_id
) VALUES (
  '${fixture.invoiceId}'::uuid, ${fixture.invoiceNumber}, current_date, 'posted',
  100, 0, 0, 100, 0, '__2D_UI_ACCEPTANCE_PURCHASE_WITHOUT_JOURNAL__', NULL
);

INSERT INTO public.purchase_invoice_items(
  id, invoice_id, product_id, description, quantity, unit_price, discount, total, net_total
) VALUES (
  '${fixture.itemId}'::uuid, '${fixture.invoiceId}'::uuid, '${fixture.productId}'::uuid,
  'بند اختبار قبول 2D', 2, 50, 0, 100, 100
);

INSERT INTO public.inventory_movements(
  id, product_id, movement_type, quantity, unit_cost, total_cost,
  reference_id, reference_type, notes, movement_date
) VALUES (
  '${fixture.movementId}'::uuid, '${fixture.productId}'::uuid, 'purchase', 2, 50, 100,
  '${fixture.invoiceId}'::uuid, 'purchase_invoice', '__2D_UI_ACCEPTANCE__', current_date
);
`;

const fixtureVerification = `
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
  WHERE value->>'source_type' = 'purchase_invoice'
    AND value->>'source_id' = '${fixture.invoiceId}'
  LIMIT 1;

  IF v_row IS NULL
     OR v_row->>'classification' <> 'movement_without_journal'
     OR (v_row->>'movement_count')::integer <> 1
     OR round((v_row->>'movement_book_value')::numeric, 2) <> 100 THEN
    RAISE EXCEPTION 'STAGING_2D_ACCEPTANCE_DIAGNOSTIC_INVALID';
  END IF;

  v_plan := public.get_inventory_reconciliation_journal_plan(
    'purchase_invoice', '${fixture.invoiceId}'::uuid, NULL
  );
  SELECT round(COALESCE(sum((line->>'debit')::numeric), 0), 2),
         round(COALESCE(sum((line->>'credit')::numeric), 0), 2)
  INTO v_debit, v_credit
  FROM jsonb_array_elements(v_plan->'correction_lines') line;

  IF COALESCE((v_plan->>'eligible')::boolean, false) IS NOT TRUE
     OR v_plan->>'reason_code' <> 'READY'
     OR v_plan->>'mode' <> 'create_full_journal'
     OR v_plan->>'source_number' <> '${fixture.invoiceNumber}'
     OR round((v_plan->>'movement_book_value')::numeric, 2) <> 100
     OR v_debit <> 100 OR v_credit <> 100
     OR jsonb_array_length(v_plan->'correction_lines') <> 2
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') line
       WHERE line->>'account_code' = '1104'
         AND (line->>'debit')::numeric = 100 AND (line->>'credit')::numeric = 0
     )
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') line
       WHERE line->>'account_code' = '2101'
         AND (line->>'debit')::numeric = 0 AND (line->>'credit')::numeric = 100
     ) THEN
    RAISE EXCEPTION 'STAGING_2D_ACCEPTANCE_PLAN_INVALID: %', v_plan;
  END IF;
END;
$fixture_verification$;
`;

const rollbackFixture = `
DO $rollback_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_invoices
    WHERE id = '${fixture.invoiceId}'::uuid
      AND invoice_number = ${fixture.invoiceNumber}
      AND notes = '__2D_UI_ACCEPTANCE_PURCHASE_WITHOUT_JOURNAL__'
      AND journal_entry_id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.inventory_reconciliation_repair_items
    WHERE source_type = 'purchase_invoice'
      AND source_id = '${fixture.invoiceId}'::uuid
  ) THEN
    RAISE EXCEPTION 'STAGING_2D_ACCEPTANCE_ROLLBACK_REFUSED';
  END IF;
END;
$rollback_guard$;

DELETE FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid;
DELETE FROM public.purchase_invoice_items WHERE id = '${fixture.itemId}'::uuid;
DELETE FROM public.purchase_invoices WHERE id = '${fixture.invoiceId}'::uuid;
DELETE FROM public.products WHERE id = '${fixture.productId}'::uuid;

DO $rollback_postcheck$
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE id = '${fixture.productId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.purchase_invoices WHERE id = '${fixture.invoiceId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.purchase_invoice_items WHERE id = '${fixture.itemId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid) THEN
    RAISE EXCEPTION 'STAGING_2D_ACCEPTANCE_ROLLBACK_POSTCHECK_FAILED';
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
${fixtureVerification}
${rollbackFixture}
SELECT jsonb_build_object(
  'result', 'STAGING_2D_PURCHASE_FIXTURE_REHEARSAL_OK',
  'source_type', 'purchase_invoice',
  'source_id', '${fixture.invoiceId}',
  'invoice_number', ${fixture.invoiceNumber},
  'rollback_tested', true
) AS result;
ROLLBACK;
`;
}

function applySql() {
  return `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
${environmentGuard}
${absenceGuard}
${insertFixture}
${fixtureVerification}
SELECT jsonb_build_object(
  'result', 'STAGING_2D_PURCHASE_FIXTURE_READY',
  'source_type', 'purchase_invoice',
  'source_id', '${fixture.invoiceId}',
  'invoice_number', ${fixture.invoiceNumber},
  'product_code', '${fixture.productCode}'
) AS result;
COMMIT;
`;
}

function explicitRollbackSql() {
  return `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
${environmentGuard}
${rollbackFixture}
SELECT jsonb_build_object(
  'result', 'STAGING_2D_PURCHASE_FIXTURE_ROLLBACK_OK',
  'source_id', '${fixture.invoiceId}'
) AS result;
COMMIT;
`;
}

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--rehearse", "--apply", "--rollback"].includes(mode) || process.argv.length > 3) {
    throw new Error("استخدم --check أو --rehearse أو --apply أو --rollback");
  }
  assertStagingLink();
  const expectedBaseline = JSON.parse(readFileSync(join(baselineDir, "baseline.json"), "utf8"));
  const reportDir = mkdtempSync(`/tmp/accounting-staging-2d-purchase-acceptance-${mode.slice(2)}-`);
  chmodSync(reportDir, 0o700);
  writeFileSync(join(reportDir, "explicit-rollback.sql"), explicitRollbackSql(), { mode: 0o600 });

  if (mode === "--check") {
    console.log("حالة قبول فاتورة الشراء 2D وخطة رجوعها جاهزتان ومقيدتان بـStaging");
    console.log(`REPORT_DIR=${reportDir}`);
    return;
  }

  const before = queryCurrentBaseline("baseline-before", reportDir);
  if (mode !== "--rollback") assertBaseline(before, expectedBaseline, "ما قبل الحالة", reportDir);
  const sql = mode === "--rehearse" ? rehearsalSql()
    : mode === "--apply" ? applySql()
      : explicitRollbackSql();
  const output = runCli(sql, mode.slice(2), reportDir);
  const result = output.rows?.find((row) => row.result)?.result;
  if (!result?.result) throw new Error("لم تعد العملية علامة تحقق");

  const after = queryCurrentBaseline("baseline-after", reportDir);
  if (mode === "--rehearse" || mode === "--rollback") {
    assertBaseline(after, expectedBaseline, "ما بعد الرجوع", reportDir);
  } else {
    if (after.counts.products !== expectedBaseline.counts.products + 1
      || after.counts.purchase_invoices !== expectedBaseline.counts.purchase_invoices + 1
      || after.counts.inventory_movements !== expectedBaseline.counts.inventory_movements + 1
      || after.counts.journal_entries !== expectedBaseline.counts.journal_entries
      || after.counts.repairs !== expectedBaseline.counts.repairs) {
      throw new Error("الأثر بعد إعداد الحالة لا يطابق الزيادة المضبوطة");
    }
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
    ? "نجحت تجربة حالة فاتورة الشراء 2D وخطة الرجوع داخل معاملة انتهت بـROLLBACK كامل"
    : mode === "--apply"
      ? "تم إعداد حالة فاتورة الشراء 2D على Staging والتحقق منها"
      : "تم الرجوع عن حالة فاتورة الشراء 2D وعاد خط الأساس بالكامل");
  console.log(`SOURCE=purchase_invoice:${fixture.invoiceNumber}`);
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
