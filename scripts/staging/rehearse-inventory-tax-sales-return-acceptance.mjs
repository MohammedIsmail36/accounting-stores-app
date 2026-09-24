// Transactional Staging-only rehearsal for a taxed sales return missing its journal.
import { isDeepStrictEqual } from "node:util";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baselineSql, extract, fixture, validateBaseline } from "./backup-inventory-tax-sales-return-acceptance-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRef = "dunzfxurefzlaamgghys";
const archive = "/backups/staging/inventory-tax-sales-return-before-20260924-030146";
const cli = "supabase@2.116.0";

function assertStaging() {
  if (readFileSync(join(root, "supabase/.temp/project-ref"), "utf8").trim() !== projectRef) {
    throw new Error("المشروع المرتبط ليس Staging المعتمد");
  }
}

function cliEnvironment() {
  if (process.getuid?.() === 0 && process.env.SUDO_USER !== "deploy") throw new Error("استخدم sudo من حساب deploy فقط");
  const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
  if (!token) throw new Error("جلسة Supabase غير موجودة");
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
    throw new Error(`فشلت تجربة مرتجع البيع (${label})؛ التشخيص: ${logPath}`);
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
  IF current_database() <> 'postgres' OR current_setting('server_version') NOT LIKE '17.%'
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923100000')
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923130000')
     OR to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NULL
     OR to_regprocedure('public.execute_inventory_reconciliation_repair(uuid,integer,uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.company_settings s JOIN public.accounts a ON a.id = s.sales_tax_account_id
       WHERE s.enable_tax IS TRUE AND s.tax_rate = 14 AND a.code = '2104' AND a.is_system IS TRUE)
     OR NOT EXISTS (SELECT 1 FROM public.sales_invoices i JOIN public.journal_entries j ON j.id = i.journal_entry_id
       WHERE i.id = '${fixture.sourceInvoiceId}'::uuid AND i.status = 'posted' AND j.status = 'posted'
         AND i.tax = 14 AND i.total = 114)
     OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = '${fixture.productId}'::uuid
       AND code = 'TST-TAX-SI-001' AND quantity_on_hand = 8 AND purchase_price = 40)
     OR EXISTS (SELECT 1 FROM public.sales_returns WHERE id = '${fixture.returnId}'::uuid OR return_number = ${fixture.returnNumber})
     OR EXISTS (SELECT 1 FROM public.sales_return_items WHERE id = '${fixture.itemId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_items
       WHERE source_type = 'sales_return' AND source_id = '${fixture.returnId}'::uuid) THEN
    RAISE EXCEPTION 'STAGING_TAX_SALES_RETURN_ACCEPTANCE_GUARD_FAILED';
  END IF;
END;
$guard$;

UPDATE public.products SET quantity_on_hand = 10 WHERE id = '${fixture.productId}'::uuid AND quantity_on_hand = 8;

INSERT INTO public.sales_returns(id, return_number, sales_invoice_id, return_date, subtotal, discount, tax, total,
  status, journal_entry_id, notes)
VALUES ('${fixture.returnId}'::uuid, ${fixture.returnNumber}, '${fixture.sourceInvoiceId}'::uuid,
  current_date, 100, 0, 14, 114, 'posted', NULL, '__TAX_SALES_RETURN_ACCEPTANCE_WITHOUT_JOURNAL__');

INSERT INTO public.sales_return_items(id, return_id, product_id, description, quantity, unit_price, discount, total)
VALUES ('${fixture.itemId}'::uuid, '${fixture.returnId}'::uuid, '${fixture.productId}'::uuid,
  'بند اختبار مرتجع بيع خاضع لضريبة 14%', 2, 50, 0, 100);

INSERT INTO public.inventory_movements(id, product_id, movement_type, quantity, unit_cost, total_cost,
  reference_id, reference_type, notes, movement_date)
VALUES ('${fixture.movementId}'::uuid, '${fixture.productId}'::uuid, 'sale_return', 2, 40, 80,
  '${fixture.returnId}'::uuid, 'sales_return', '__TAX_SALES_RETURN_ACCEPTANCE__', current_date);

DO $verify$
DECLARE
  v_source jsonb;
  v_plan jsonb;
  v_debit numeric;
  v_credit numeric;
BEGIN
  SELECT value INTO v_source FROM jsonb_array_elements(public.get_inventory_reconciliation_diagnostic(
    'sources', true, '${fixture.returnId}', 500, 0, NULL
  )->'rows') WHERE value->>'source_type' = 'sales_return' AND value->>'source_id' = '${fixture.returnId}' LIMIT 1;
  v_plan := public.get_inventory_reconciliation_journal_plan('sales_return', '${fixture.returnId}'::uuid, NULL);
  SELECT round(COALESCE(sum((line->>'debit')::numeric), 0), 2), round(COALESCE(sum((line->>'credit')::numeric), 0), 2)
  INTO v_debit, v_credit FROM jsonb_array_elements(v_plan->'correction_lines') line;
  IF v_source IS NULL OR v_source->>'classification' <> 'movement_without_journal'
     OR (v_source->>'movement_count')::integer <> 1
     OR round((v_source->>'movement_book_value')::numeric, 2) <> 80
     OR (SELECT quantity_on_hand FROM public.products WHERE id = '${fixture.productId}'::uuid) <> 10
     OR (SELECT sum(public.inventory_signed_quantity(movement_type::text, quantity))
         FROM public.inventory_movements WHERE product_id = '${fixture.productId}'::uuid) <> 10
     OR COALESCE((v_plan->>'eligible')::boolean, false) IS NOT TRUE
     OR v_plan->>'reason_code' <> 'READY' OR v_plan->>'mode' <> 'create_full_journal'
     OR v_plan->>'source_number' <> '${fixture.returnNumber}'
     OR round((v_plan->>'movement_book_value')::numeric, 2) <> 80
     OR v_debit <> 194 OR v_credit <> 194 OR jsonb_array_length(v_plan->'correction_lines') <> 5
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') l WHERE l->>'account_code' = '4101' AND (l->>'debit')::numeric = 100 AND (l->>'credit')::numeric = 0)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') l WHERE l->>'account_code' = '1103' AND (l->>'debit')::numeric = 0 AND (l->>'credit')::numeric = 114)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') l WHERE l->>'account_code' = '2104' AND (l->>'debit')::numeric = 14 AND (l->>'credit')::numeric = 0)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') l WHERE l->>'account_code' = '1104' AND (l->>'debit')::numeric = 80 AND (l->>'credit')::numeric = 0)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') l WHERE l->>'account_code' = '5101' AND (l->>'debit')::numeric = 0 AND (l->>'credit')::numeric = 80) THEN
    RAISE EXCEPTION 'STAGING_TAX_SALES_RETURN_PLAN_INVALID: source=%, plan=%', v_source, v_plan;
  END IF;
END;
$verify$;

DO $explicit_rollback$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sales_returns WHERE id = '${fixture.returnId}'::uuid
      AND return_number = ${fixture.returnNumber} AND sales_invoice_id = '${fixture.sourceInvoiceId}'::uuid
      AND notes = '__TAX_SALES_RETURN_ACCEPTANCE_WITHOUT_JOURNAL__' AND journal_entry_id IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = '${fixture.productId}'::uuid AND quantity_on_hand = 10)
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_items WHERE source_type = 'sales_return'
       AND source_id = '${fixture.returnId}'::uuid) THEN
    RAISE EXCEPTION 'STAGING_TAX_SALES_RETURN_ROLLBACK_REFUSED';
  END IF;
  DELETE FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid;
  DELETE FROM public.sales_return_items WHERE id = '${fixture.itemId}'::uuid;
  DELETE FROM public.sales_returns WHERE id = '${fixture.returnId}'::uuid;
  UPDATE public.products SET quantity_on_hand = 8 WHERE id = '${fixture.productId}'::uuid AND quantity_on_hand = 10;
  IF EXISTS (SELECT 1 FROM public.sales_returns WHERE id = '${fixture.returnId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid)
     OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = '${fixture.productId}'::uuid AND quantity_on_hand = 8) THEN
    RAISE EXCEPTION 'STAGING_TAX_SALES_RETURN_ROLLBACK_POSTCHECK_FAILED';
  END IF;
END;
$explicit_rollback$;

SELECT jsonb_build_object('result', 'STAGING_TAX_SALES_RETURN_REHEARSAL_OK', 'return_number', ${fixture.returnNumber},
  'tax_rate', 14, 'debit', 194, 'credit', 194, 'source_type', 'sales_return', 'rolled_back', true) AS sales_return_rehearsal;
ROLLBACK;
`;

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStaging();
  process.umask(0o077);
  const expected = validateBaseline(JSON.parse(readFileSync(join(archive, "baseline.json"), "utf8")));
  const dir = mkdtempSync("/tmp/accounting-staging-tax-sales-return-rehearsal-");
  chmodSync(dir, 0o700);
  const before = validateBaseline(extract(runCli(baselineSql, "baseline-before", dir), "sales_return_acceptance_baseline"));
  assertSame(before, expected, "قبل التجربة", dir);
  const result = extract(runCli(rehearsalSql, "rehearsal", dir), "sales_return_rehearsal");
  if (result?.result !== "STAGING_TAX_SALES_RETURN_REHEARSAL_OK" || result.rolled_back !== true
      || Number(result.debit) !== 194 || Number(result.credit) !== 194) throw new Error(`نتيجة التجربة غير سليمة: ${dir}`);
  const after = validateBaseline(extract(runCli(baselineSql, "baseline-after", dir), "sales_return_acceptance_baseline"));
  assertSame(after, expected, "بعد الرجوع", dir);
  writeFileSync(join(dir, "report.json"), `${JSON.stringify({ ...result, projectRef, baselineRestored: true,
    productionModified: false, createdAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجحت تجربة مرتجع البيع الضريبي على Staging داخل معاملة انتهت بـ ROLLBACK كامل");
  console.log("الخطة متوازنة: 4101 مدين 100، 1103 دائن 114، 2104 مدين 14، 1104 مدين 80، 5101 دائن 80");
  console.log("عادت بطاقة المنتج وبيانات الأعمال والتشخيص إلى خط الأساس؛ لم تُنشأ حالة دائمة");
  console.log(`REPORT_DIR=${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
