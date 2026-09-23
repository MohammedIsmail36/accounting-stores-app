// Transactional Staging-only rehearsal for a taxed purchase without a journal.
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
import {
  acceptanceFixture as fixture,
  baselineSql,
  extractNamedPayload,
  validateBaseline,
} from "./backup-inventory-tax-purchase-acceptance-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const baselineDir = "/tmp/staging-inventory-tax-purchase-acceptance-before-mS6b33";
const cli = "supabase@2.116.0";

function assertStagingLink() {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفضت التجربة: المشروع المرتبط ليس Staging المعتمد");
  }
}

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") throw new Error("شغّل التجربة بواسطة sudo من حساب deploy فقط");
    const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
    if (!token) throw new Error("جلسة Supabase للمستخدم deploy غير موجودة");
    return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: token };
  }
  return process.env;
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
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  writeFileSync(logPath, output, { mode: 0o600 });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    throw new Error(`فشلت تجربة فاتورة الشراء الضريبية (${label})؛ التشخيص: ${logPath}`);
  }
  return JSON.parse(result.stdout);
}

function normalizeBaseline(value) {
  const normalized = structuredClone(value);
  if (normalized?.diagnostic) delete normalized.diagnostic.snapshot_at;
  return normalized;
}

function assertSameBaseline(actual, expected, label, reportDir) {
  if (!isDeepStrictEqual(normalizeBaseline(actual), normalizeBaseline(expected))) {
    writeFileSync(join(reportDir, `${label}-mismatch.json`), `${JSON.stringify({ expected, actual }, null, 2)}\n`, { mode: 0o600 });
    throw new Error(`تغير خط أساس Staging في ${label}؛ ألغيت التجربة`);
  }
}

export const rehearsalSql = `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $environment_guard$
BEGIN
  IF current_database() <> 'postgres'
     OR current_setting('server_version') NOT LIKE '17.%'
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923100000')
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923130000')
     OR to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NULL
     OR to_regprocedure('public.execute_inventory_reconciliation_repair(uuid,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'STAGING_TAX_PURCHASE_ACCEPTANCE_ENVIRONMENT_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE id = '${fixture.productId}'::uuid OR code = '${fixture.productCode}')
     OR EXISTS (SELECT 1 FROM public.purchase_invoices WHERE id = '${fixture.invoiceId}'::uuid OR invoice_number = ${fixture.invoiceNumber})
     OR EXISTS (SELECT 1 FROM public.purchase_invoice_items WHERE id = '${fixture.itemId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid) THEN
    RAISE EXCEPTION 'STAGING_TAX_PURCHASE_ACCEPTANCE_FIXTURE_ALREADY_EXISTS';
  END IF;
END;
$environment_guard$;

UPDATE public.company_settings
SET enable_tax = true, tax_rate = 14
WHERE id = (SELECT id FROM public.company_settings ORDER BY created_at LIMIT 1)
  AND enable_tax IS FALSE
  AND tax_rate = 0
  AND purchase_tax_account_id = (SELECT id FROM public.accounts WHERE code = '1105')
  AND sales_tax_account_id = (SELECT id FROM public.accounts WHERE code = '2104');

DO $settings_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_settings s
    JOIN public.accounts p ON p.id = s.purchase_tax_account_id
    JOIN public.accounts v ON v.id = s.sales_tax_account_id
    WHERE s.enable_tax IS TRUE AND s.tax_rate = 14
      AND p.code = '1105' AND p.is_system IS TRUE
      AND v.code = '2104' AND v.is_system IS TRUE
  ) THEN
    RAISE EXCEPTION 'STAGING_TAX_PURCHASE_ACCEPTANCE_SETTINGS_INVALID';
  END IF;
END;
$settings_guard$;

INSERT INTO public.products(
  id, code, name, purchase_price, selling_price, quantity_on_hand, min_stock_level, is_active
) VALUES (
  '${fixture.productId}'::uuid, '${fixture.productCode}',
  'منتج اختبار قبول فاتورة شراء ضريبية', 50, 75, 2, 0, true
);

INSERT INTO public.purchase_invoices(
  id, invoice_number, invoice_date, status, subtotal, discount, tax, total,
  paid_amount, notes, journal_entry_id
) VALUES (
  '${fixture.invoiceId}'::uuid, ${fixture.invoiceNumber}, current_date, 'posted',
  100, 0, 14, 114, 0, '__TAX_PURCHASE_ACCEPTANCE_WITHOUT_JOURNAL__', NULL
);

INSERT INTO public.purchase_invoice_items(
  id, invoice_id, product_id, description, quantity, unit_price, discount, total, net_total
) VALUES (
  '${fixture.itemId}'::uuid, '${fixture.invoiceId}'::uuid, '${fixture.productId}'::uuid,
  'بند اختبار شراء خاضع لضريبة 14%', 2, 50, 0, 100, 100
);

INSERT INTO public.inventory_movements(
  id, product_id, movement_type, quantity, unit_cost, total_cost,
  reference_id, reference_type, notes, movement_date
) VALUES (
  '${fixture.movementId}'::uuid, '${fixture.productId}'::uuid, 'purchase', 2, 50, 100,
  '${fixture.invoiceId}'::uuid, 'purchase_invoice', '__TAX_PURCHASE_ACCEPTANCE__', current_date
);

DO $plan_verification$
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
    RAISE EXCEPTION 'STAGING_TAX_PURCHASE_ACCEPTANCE_DIAGNOSTIC_INVALID: %', v_row;
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
     OR v_debit <> 114 OR v_credit <> 114
     OR jsonb_array_length(v_plan->'correction_lines') <> 3
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') line
       WHERE line->>'account_code' = '1104'
         AND (line->>'debit')::numeric = 100 AND (line->>'credit')::numeric = 0
     )
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') line
       WHERE line->>'account_code' = '1105'
         AND (line->>'debit')::numeric = 14 AND (line->>'credit')::numeric = 0
     )
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') line
       WHERE line->>'account_code' = '2101'
         AND (line->>'debit')::numeric = 0 AND (line->>'credit')::numeric = 114
     ) THEN
    RAISE EXCEPTION 'STAGING_TAX_PURCHASE_ACCEPTANCE_PLAN_INVALID: %', v_plan;
  END IF;
END;
$plan_verification$;

SELECT jsonb_build_object(
  'result', 'STAGING_TAX_PURCHASE_ACCEPTANCE_REHEARSAL_OK',
  'tax_rate', 14,
  'source_type', 'purchase_invoice',
  'source_id', '${fixture.invoiceId}',
  'invoice_number', ${fixture.invoiceNumber},
  'subtotal', 100,
  'tax', 14,
  'total', 114,
  'lines', jsonb_build_array(
    jsonb_build_object('account_code', '1104', 'debit', 100, 'credit', 0),
    jsonb_build_object('account_code', '1105', 'debit', 14, 'credit', 0),
    jsonb_build_object('account_code', '2101', 'debit', 0, 'credit', 114)
  ),
  'rolled_back', true
) AS tax_purchase_rehearsal;
ROLLBACK;
`;

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStagingLink();
  process.umask(0o077);
  const reportDir = mkdtempSync("/tmp/accounting-staging-tax-purchase-rehearsal-");
  chmodSync(reportDir, 0o700);
  const expected = validateBaseline(JSON.parse(readFileSync(join(baselineDir, "baseline.json"), "utf8")));

  const before = validateBaseline(extractNamedPayload(
    runCli(baselineSql, "baseline-before", reportDir), "tax_purchase_acceptance_baseline",
  ));
  assertSameBaseline(before, expected, "قبل التجربة", reportDir);

  const rehearsal = extractNamedPayload(
    runCli(rehearsalSql, "rehearsal", reportDir), "tax_purchase_rehearsal",
  );
  if (rehearsal?.result !== "STAGING_TAX_PURCHASE_ACCEPTANCE_REHEARSAL_OK"
      || rehearsal?.rolled_back !== true || Number(rehearsal?.tax_rate) !== 14) {
    throw new Error(`نتيجة تجربة فاتورة الشراء الضريبية غير صحيحة: ${reportDir}`);
  }

  const after = validateBaseline(extractNamedPayload(
    runCli(baselineSql, "baseline-after", reportDir), "tax_purchase_acceptance_baseline",
  ));
  assertSameBaseline(after, expected, "بعد الرجوع", reportDir);

  const report = {
    result: rehearsal.result,
    projectRef: expectedProjectRef,
    taxRate: 14,
    invoiceNumber: fixture.invoiceNumber,
    expectedJournal: rehearsal.lines,
    transactionRolledBack: true,
    baselineRestored: true,
    productionModified: false,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log("نجحت تجربة فاتورة شراء بضريبة 14% على Staging داخل معاملة انتهت بـ ROLLBACK كامل");
  console.log("المخطط متوازن: 1104 مدين 100، و1105 مدين 14، و2101 دائن 114");
  console.log("عادت إعدادات الضريبة وبيانات الأعمال والتشخيص إلى خط الأساس؛ لم تُنشأ بيانات دائمة");
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
