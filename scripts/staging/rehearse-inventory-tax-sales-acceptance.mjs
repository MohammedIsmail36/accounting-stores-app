// Transactional Staging-only rehearsal for a taxed sale without its journal.
import { isDeepStrictEqual } from "node:util";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baselineSql, extract, fixture, validateBaseline } from "./backup-inventory-tax-sales-acceptance-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRef = "dunzfxurefzlaamgghys";
const archive = "/backups/staging/inventory-tax-sales-acceptance-before-20260923-145639";
const cli = "supabase@2.116.0";

function assertStaging() {
  if (readFileSync(join(root, "supabase/.temp/project-ref"), "utf8").trim() !== projectRef) {
    throw new Error("المشروع المرتبط ليس Staging المعتمد");
  }
}

function cliEnvironment() {
  const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
  if (!token) throw new Error("جلسة Supabase غير موجودة");
  if (process.getuid?.() === 0 && process.env.SUDO_USER !== "deploy") throw new Error("استخدم sudo من حساب deploy فقط");
  return { ...process.env, ...(process.getuid?.() === 0 ? { HOME: "/home/deploy" } : {}), SUPABASE_ACCESS_TOKEN: token };
}

function runCli(sql, label, dir) {
  assertStaging();
  const sqlPath = join(dir, `${label}.sql`);
  const logPath = join(dir, `${label}.log`);
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  const result = spawnSync("npx", ["-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", sqlPath], {
    cwd: root, env: cliEnvironment(), encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n`, { mode: 0o600 });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    throw new Error(`فشلت تجربة البيع الضريبي (${label})؛ التشخيص: ${logPath}`);
  }
  return JSON.parse(result.stdout);
}

function normalize(value) {
  const copy = structuredClone(value);
  if (copy?.diagnostic) delete copy.diagnostic.snapshot_at;
  return copy;
}

function assertSame(actual, expected, label, dir) {
  if (!isDeepStrictEqual(normalize(actual), normalize(expected))) {
    writeFileSync(join(dir, `${label}-mismatch.json`), `${JSON.stringify({ expected, actual }, null, 2)}\n`, { mode: 0o600 });
    throw new Error(`تغير خط أساس Staging ${label}؛ أُلغيت التجربة`);
  }
}

export const rehearsalSql = `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $guard$
BEGIN
  IF current_database() <> 'postgres'
     OR current_setting('server_version') NOT LIKE '17.%'
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923100000')
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923130000')
     OR to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NULL
     OR to_regprocedure('public.execute_inventory_reconciliation_repair(uuid,integer,uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.company_settings s
       JOIN public.accounts a ON a.id = s.sales_tax_account_id
       WHERE s.enable_tax IS TRUE AND s.tax_rate = 14 AND a.code = '2104' AND a.is_system IS TRUE)
     OR EXISTS (SELECT 1 FROM public.products WHERE id = '${fixture.productId}'::uuid OR code = '${fixture.productCode}')
     OR EXISTS (SELECT 1 FROM public.sales_invoices WHERE id = '${fixture.invoiceId}'::uuid OR invoice_number = ${fixture.invoiceNumber})
     OR EXISTS (SELECT 1 FROM public.sales_invoice_items WHERE id = '${fixture.itemId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE id IN ('${fixture.saleMovementId}'::uuid, '${fixture.openingMovementId}'::uuid))
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_items WHERE source_type = 'sales_invoice' AND source_id = '${fixture.invoiceId}'::uuid) THEN
    RAISE EXCEPTION 'STAGING_TAX_SALES_ACCEPTANCE_GUARD_FAILED';
  END IF;
END;
$guard$;

INSERT INTO public.products(id, code, name, purchase_price, selling_price, quantity_on_hand, min_stock_level, is_active)
VALUES ('${fixture.productId}'::uuid, '${fixture.productCode}', 'منتج اختبار قبول بيع بضريبة 14%', 40, 50, 8, 0, true);

DO $opening$
DECLARE
  v_inventory uuid;
  v_equity uuid;
  v_journal uuid;
BEGIN
  SELECT id INTO STRICT v_inventory FROM public.accounts WHERE code = '1104';
  SELECT id INTO STRICT v_equity FROM public.accounts WHERE code = '3101';
  v_journal := public.create_journal_entry(current_date, '__TAX_SALES_ACCEPTANCE_OPENING__', jsonb_build_array(
    jsonb_build_object('account_id', v_inventory, 'debit', 400, 'credit', 0, 'description', 'رصيد افتتاحي لاختبار البيع الضريبي'),
    jsonb_build_object('account_id', v_equity, 'debit', 0, 'credit', 400, 'description', 'مقابل رصيد افتتاحي لاختبار البيع الضريبي')
  ), 'posted', NULL, 'regular');
  INSERT INTO public.inventory_movements(id, product_id, movement_type, quantity, unit_cost, total_cost, reference_id, reference_type, notes, movement_date)
  VALUES ('${fixture.openingMovementId}'::uuid, '${fixture.productId}'::uuid, 'opening_balance', 10, 40, 400,
    v_journal, 'staging_seed', '__TAX_SALES_ACCEPTANCE_OPENING__', current_date);
END;
$opening$;

INSERT INTO public.sales_invoices(id, invoice_number, invoice_date, status, subtotal, discount, tax, total, paid_amount, notes, journal_entry_id)
VALUES ('${fixture.invoiceId}'::uuid, ${fixture.invoiceNumber}, current_date, 'posted', 100, 0, 14, 114, 0,
  '__TAX_SALES_ACCEPTANCE_WITHOUT_JOURNAL__', NULL);

INSERT INTO public.sales_invoice_items(id, invoice_id, product_id, description, quantity, unit_price, discount, total)
VALUES ('${fixture.itemId}'::uuid, '${fixture.invoiceId}'::uuid, '${fixture.productId}'::uuid,
  'بند اختبار بيع خاضع لضريبة 14%', 2, 50, 0, 100);

INSERT INTO public.inventory_movements(id, product_id, movement_type, quantity, unit_cost, total_cost, reference_id, reference_type, notes, movement_date)
VALUES ('${fixture.saleMovementId}'::uuid, '${fixture.productId}'::uuid, 'sale', 2, 40, 80,
  '${fixture.invoiceId}'::uuid, 'sales_invoice', '__TAX_SALES_ACCEPTANCE__', current_date);

DO $verify$
DECLARE
  v_source jsonb;
  v_opening jsonb;
  v_plan jsonb;
  v_debit numeric;
  v_credit numeric;
BEGIN
  SELECT value INTO v_source FROM jsonb_array_elements(public.get_inventory_reconciliation_diagnostic(
    'sources', true, '${fixture.invoiceId}', 500, 0, NULL
  )->'rows') WHERE value->>'source_type' = 'sales_invoice' AND value->>'source_id' = '${fixture.invoiceId}' LIMIT 1;

  SELECT value INTO v_opening FROM jsonb_array_elements(public.get_inventory_reconciliation_diagnostic(
    'sources', false, NULL, 500, 0, NULL
  )->'rows') WHERE value->>'source_type' = 'staging_seed'
    AND value->>'source_id' = (SELECT reference_id::text FROM public.inventory_movements WHERE id = '${fixture.openingMovementId}'::uuid) LIMIT 1;

  v_plan := public.get_inventory_reconciliation_journal_plan('sales_invoice', '${fixture.invoiceId}'::uuid, NULL);
  SELECT round(COALESCE(sum((line->>'debit')::numeric), 0), 2), round(COALESCE(sum((line->>'credit')::numeric), 0), 2)
  INTO v_debit, v_credit FROM jsonb_array_elements(v_plan->'correction_lines') line;

  IF v_source IS NULL OR v_source->>'classification' <> 'movement_without_journal'
     OR (v_source->>'movement_count')::integer <> 1
     OR round((v_source->>'movement_book_value')::numeric, 2) <> -80
     OR v_opening IS NULL OR v_opening->>'classification' <> 'matched'
     OR round((v_opening->>'movement_book_value')::numeric, 2) <> 400
     OR round((v_opening->>'ledger_1104_value')::numeric, 2) <> 400
     OR (SELECT quantity_on_hand FROM public.products WHERE id = '${fixture.productId}'::uuid) <> 8
     OR (SELECT sum(public.inventory_signed_quantity(movement_type::text, quantity))
         FROM public.inventory_movements WHERE product_id = '${fixture.productId}'::uuid) <> 8
     OR COALESCE((v_plan->>'eligible')::boolean, false) IS NOT TRUE
     OR v_plan->>'reason_code' <> 'READY' OR v_plan->>'mode' <> 'create_full_journal'
     OR v_plan->>'source_number' <> '${fixture.invoiceNumber}'
     OR round((v_plan->>'movement_book_value')::numeric, 2) <> -80
     OR v_debit <> 194 OR v_credit <> 194 OR jsonb_array_length(v_plan->'correction_lines') <> 5
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') l WHERE l->>'account_code' = '1103' AND (l->>'debit')::numeric = 114 AND (l->>'credit')::numeric = 0)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') l WHERE l->>'account_code' = '4101' AND (l->>'debit')::numeric = 0 AND (l->>'credit')::numeric = 100)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') l WHERE l->>'account_code' = '2104' AND (l->>'debit')::numeric = 0 AND (l->>'credit')::numeric = 14)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') l WHERE l->>'account_code' = '5101' AND (l->>'debit')::numeric = 80 AND (l->>'credit')::numeric = 0)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') l WHERE l->>'account_code' = '1104' AND (l->>'debit')::numeric = 0 AND (l->>'credit')::numeric = 80) THEN
    RAISE EXCEPTION 'STAGING_TAX_SALES_ACCEPTANCE_PLAN_INVALID: source=%, opening=%, plan=%', v_source, v_opening, v_plan;
  END IF;
END;
$verify$;

DO $explicit_rollback$
DECLARE v_journal uuid;
BEGIN
  SELECT reference_id INTO v_journal FROM public.inventory_movements WHERE id = '${fixture.openingMovementId}'::uuid AND reference_type = 'staging_seed';
  IF v_journal IS NULL OR NOT EXISTS (SELECT 1 FROM public.journal_entries WHERE id = v_journal AND description = '__TAX_SALES_ACCEPTANCE_OPENING__' AND status = 'posted')
     OR NOT EXISTS (SELECT 1 FROM public.sales_invoices WHERE id = '${fixture.invoiceId}'::uuid AND invoice_number = ${fixture.invoiceNumber}
       AND notes = '__TAX_SALES_ACCEPTANCE_WITHOUT_JOURNAL__' AND journal_entry_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_items WHERE source_type = 'sales_invoice' AND source_id = '${fixture.invoiceId}'::uuid) THEN
    RAISE EXCEPTION 'STAGING_TAX_SALES_ACCEPTANCE_ROLLBACK_REFUSED';
  END IF;
  DELETE FROM public.inventory_movements WHERE id IN ('${fixture.saleMovementId}'::uuid, '${fixture.openingMovementId}'::uuid);
  DELETE FROM public.sales_invoice_items WHERE id = '${fixture.itemId}'::uuid;
  DELETE FROM public.sales_invoices WHERE id = '${fixture.invoiceId}'::uuid;
  DELETE FROM public.products WHERE id = '${fixture.productId}'::uuid;
  DELETE FROM public.journal_entry_lines WHERE journal_entry_id = v_journal;
  DELETE FROM public.journal_entries WHERE id = v_journal;
  IF EXISTS (SELECT 1 FROM public.sales_invoices WHERE id = '${fixture.invoiceId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE id IN ('${fixture.saleMovementId}'::uuid, '${fixture.openingMovementId}'::uuid))
     OR EXISTS (SELECT 1 FROM public.journal_entries WHERE id = v_journal) THEN
    RAISE EXCEPTION 'STAGING_TAX_SALES_ACCEPTANCE_ROLLBACK_POSTCHECK_FAILED';
  END IF;
END;
$explicit_rollback$;

SELECT jsonb_build_object('result', 'STAGING_TAX_SALES_ACCEPTANCE_REHEARSAL_OK',
  'invoice_number', ${fixture.invoiceNumber}, 'tax_rate', 14, 'debit', 194, 'credit', 194,
  'source_type', 'sales_invoice', 'rolled_back', true) AS tax_sales_rehearsal;
ROLLBACK;
`;

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStaging();
  process.umask(0o077);
  const expected = validateBaseline(JSON.parse(readFileSync(join(archive, "baseline.json"), "utf8")));
  const dir = mkdtempSync("/tmp/accounting-staging-tax-sales-rehearsal-");
  chmodSync(dir, 0o700);
  const before = validateBaseline(extract(runCli(baselineSql, "baseline-before", dir), "tax_sales_acceptance_baseline"));
  assertSame(before, expected, "قبل التجربة", dir);
  const result = extract(runCli(rehearsalSql, "rehearsal", dir), "tax_sales_rehearsal");
  if (result?.result !== "STAGING_TAX_SALES_ACCEPTANCE_REHEARSAL_OK" || result.rolled_back !== true
      || Number(result.debit) !== 194 || Number(result.credit) !== 194) throw new Error(`نتيجة التجربة غير سليمة: ${dir}`);
  const after = validateBaseline(extract(runCli(baselineSql, "baseline-after", dir), "tax_sales_acceptance_baseline"));
  assertSame(after, expected, "بعد الرجوع", dir);
  writeFileSync(join(dir, "report.json"), `${JSON.stringify({ ...result, projectRef, baselineRestored: true, productionModified: false, createdAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجحت تجربة البيع الضريبي على Staging داخل معاملة انتهت بـ ROLLBACK كامل");
  console.log("الخطة متوازنة: 1103 مدين 114، 4101 دائن 100، 2104 دائن 14، 5101 مدين 80، 1104 دائن 80");
  console.log("عادت بيانات الأعمال والتشخيص إلى خط الأساس؛ لم تُنشأ حالة دائمة");
  console.log(`REPORT_DIR=${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
