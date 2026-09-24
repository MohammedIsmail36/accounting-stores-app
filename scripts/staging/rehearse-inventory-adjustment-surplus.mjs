// Staging-only transactional acceptance rehearsal for an inventory surplus.
import { isDeepStrictEqual } from "node:util";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baselineSql, extract, fixture, validateBaseline } from "./backup-inventory-adjustment-surplus-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRef = "dunzfxurefzlaamgghys";
const archive = "/backups/staging/inventory-adjustment-surplus-before-20260924-044842";
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
    throw new Error(`فشلت تجربة فائض المخزون (${label})؛ التشخيص: ${logPath}`);
  }
  return JSON.parse(result.stdout);
}

function normalized(value) {
  const copy = structuredClone(value);
  if (copy?.diagnostic) delete copy.diagnostic.snapshot_at;
  return copy;
}

function assertSame(actual, expected, label, dir) {
  if (!isDeepStrictEqual(normalized(actual), normalized(expected))) {
    writeFileSync(join(dir, `${label}-mismatch.json`), `${JSON.stringify({ expected, actual }, null, 2)}\n`, { mode: 0o600 });
    throw new Error(`تغير خط أساس Staging ${label}؛ أُلغيت التجربة`);
  }
}

export const rehearsalSql = `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $guard$
BEGIN
  IF current_database() <> 'postgres' OR current_setting('server_version') NOT LIKE '17.%'
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921213000')
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921220000')
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921233000')
     OR to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.accounts a JOIN public.accounts p ON p.id = a.parent_id
       WHERE a.code = '4201' AND a.is_system AND a.is_active AND NOT a.is_parent
         AND a.account_type = 'revenue' AND p.code = '4')
     OR NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.code = '1104'
       AND a.is_system AND a.is_active AND NOT a.is_parent AND a.account_type = 'asset')
     OR NOT EXISTS (SELECT 1 FROM public.inventory_adjustments a
       JOIN public.journal_entries j ON j.id = a.journal_entry_id
       WHERE a.id = '${fixture.priorShortageId}'::uuid AND a.adjustment_number = 990028
         AND a.status = 'posted' AND j.status = 'posted' AND j.posted_number = 321)
     OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = '${fixture.productId}'::uuid
       AND code = 'TST-TAX-SI-001' AND quantity_on_hand = 9 AND purchase_price = 40)
     OR (SELECT COALESCE(sum(public.inventory_signed_quantity(movement_type::text, quantity)), 0)
       FROM public.inventory_movements WHERE product_id = '${fixture.productId}'::uuid) <> 9
     OR EXISTS (SELECT 1 FROM public.inventory_adjustments
       WHERE id = '${fixture.adjustmentId}'::uuid OR adjustment_number = ${fixture.adjustmentNumber})
     OR EXISTS (SELECT 1 FROM public.inventory_adjustment_items WHERE id = '${fixture.itemId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_items
       WHERE source_type = 'adjustment' AND source_id = '${fixture.adjustmentId}'::uuid) THEN
    RAISE EXCEPTION 'STAGING_ADJUSTMENT_SURPLUS_GUARD_FAILED';
  END IF;
END;
$guard$;

UPDATE public.products SET quantity_on_hand = 10
WHERE id = '${fixture.productId}'::uuid AND quantity_on_hand = 9;

INSERT INTO public.inventory_adjustments(id, adjustment_number, adjustment_date, description, status, journal_entry_id)
VALUES ('${fixture.adjustmentId}'::uuid, ${fixture.adjustmentNumber}, current_date,
  '__INVENTORY_SURPLUS_ACCEPTANCE_WITHOUT_JOURNAL__', 'posted', NULL);

INSERT INTO public.inventory_adjustment_items(id, adjustment_id, product_id, system_quantity,
  actual_quantity, difference, unit_cost, total_cost, notes)
VALUES ('${fixture.itemId}'::uuid, '${fixture.adjustmentId}'::uuid, '${fixture.productId}'::uuid,
  9, 10, 1, 40, 40, '__INVENTORY_SURPLUS_ACCEPTANCE__');

INSERT INTO public.inventory_movements(id, product_id, movement_type, quantity, unit_cost, total_cost,
  reference_id, reference_type, notes, movement_date)
VALUES ('${fixture.movementId}'::uuid, '${fixture.productId}'::uuid, 'adjustment', 1, 40, 40,
  '${fixture.adjustmentId}'::uuid, 'adjustment', '__INVENTORY_SURPLUS_ACCEPTANCE__', current_date);

DO $verify$
DECLARE
  v_source jsonb;
  v_plan jsonb;
  v_debit numeric;
  v_credit numeric;
BEGIN
  SELECT value INTO v_source FROM jsonb_array_elements(public.get_inventory_reconciliation_diagnostic(
    'sources', true, '${fixture.adjustmentId}', 500, 0, NULL
  )->'rows') WHERE value->>'source_type' = 'adjustment' AND value->>'source_id' = '${fixture.adjustmentId}' LIMIT 1;
  v_plan := public.get_inventory_reconciliation_journal_plan('adjustment', '${fixture.adjustmentId}'::uuid, NULL);
  SELECT round(COALESCE(sum((line->>'debit')::numeric), 0), 2), round(COALESCE(sum((line->>'credit')::numeric), 0), 2)
  INTO v_debit, v_credit FROM jsonb_array_elements(v_plan->'correction_lines') line;
  IF v_source IS NULL OR v_source->>'classification' <> 'movement_without_journal'
     OR (v_source->>'movement_count')::integer <> 1
     OR round((v_source->>'movement_book_value')::numeric, 2) <> 40
     OR (SELECT quantity_on_hand FROM public.products WHERE id = '${fixture.productId}'::uuid) <> 10
     OR (SELECT sum(public.inventory_signed_quantity(movement_type::text, quantity))
         FROM public.inventory_movements WHERE product_id = '${fixture.productId}'::uuid) <> 10
     OR COALESCE((v_plan->>'eligible')::boolean, false) IS NOT TRUE
     OR v_plan->>'reason_code' <> 'READY' OR v_plan->>'mode' <> 'create_full_journal'
     OR v_plan->>'source_number' <> '${fixture.adjustmentNumber}'
     OR round((v_plan->>'movement_book_value')::numeric, 2) <> 40
     OR v_debit <> 40 OR v_credit <> 40 OR jsonb_array_length(v_plan->'correction_lines') <> 2
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') l
       WHERE l->>'account_code' = '1104' AND (l->>'debit')::numeric = 40 AND (l->>'credit')::numeric = 0)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'correction_lines') l
       WHERE l->>'account_code' = '4201' AND (l->>'debit')::numeric = 0 AND (l->>'credit')::numeric = 40) THEN
    RAISE EXCEPTION 'STAGING_ADJUSTMENT_SURPLUS_PLAN_INVALID: source=%, plan=%', v_source, v_plan;
  END IF;
END;
$verify$;

DO $explicit_rollback$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.inventory_adjustments WHERE id = '${fixture.adjustmentId}'::uuid
      AND adjustment_number = ${fixture.adjustmentNumber}
      AND description = '__INVENTORY_SURPLUS_ACCEPTANCE_WITHOUT_JOURNAL__'
      AND status = 'posted' AND journal_entry_id IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = '${fixture.productId}'::uuid AND quantity_on_hand = 10)
     OR NOT EXISTS (SELECT 1 FROM public.inventory_adjustment_items WHERE id = '${fixture.itemId}'::uuid
       AND adjustment_id = '${fixture.adjustmentId}'::uuid AND difference = 1 AND total_cost = 40)
     OR NOT EXISTS (SELECT 1 FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid
       AND reference_id = '${fixture.adjustmentId}'::uuid AND movement_type = 'adjustment' AND quantity = 1)
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_items WHERE source_type = 'adjustment'
       AND source_id = '${fixture.adjustmentId}'::uuid) THEN
    RAISE EXCEPTION 'STAGING_ADJUSTMENT_SURPLUS_ROLLBACK_REFUSED';
  END IF;
  DELETE FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid;
  DELETE FROM public.inventory_adjustment_items WHERE id = '${fixture.itemId}'::uuid;
  DELETE FROM public.inventory_adjustments WHERE id = '${fixture.adjustmentId}'::uuid;
  UPDATE public.products SET quantity_on_hand = 9 WHERE id = '${fixture.productId}'::uuid AND quantity_on_hand = 10;
  IF EXISTS (SELECT 1 FROM public.inventory_adjustments WHERE id = '${fixture.adjustmentId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid)
     OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = '${fixture.productId}'::uuid AND quantity_on_hand = 9) THEN
    RAISE EXCEPTION 'STAGING_ADJUSTMENT_SURPLUS_ROLLBACK_POSTCHECK_FAILED';
  END IF;
END;
$explicit_rollback$;

SELECT jsonb_build_object('result', 'STAGING_ADJUSTMENT_SURPLUS_REHEARSAL_OK',
  'adjustment_number', ${fixture.adjustmentNumber}, 'debit', 40, 'credit', 40,
  'source_type', 'adjustment', 'gain_account', '4201', 'rolled_back', true) AS adjustment_surplus_rehearsal;
ROLLBACK;
`;

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStaging();
  process.umask(0o077);
  const expected = validateBaseline(JSON.parse(readFileSync(join(archive, "baseline.json"), "utf8")));
  const dir = mkdtempSync("/tmp/accounting-staging-adjustment-surplus-rehearsal-");
  chmodSync(dir, 0o700);
  const before = validateBaseline(extract(runCli(baselineSql, "baseline-before", dir), "adjustment_surplus_baseline"));
  assertSame(before, expected, "قبل التجربة", dir);
  const result = extract(runCli(rehearsalSql, "rehearsal", dir), "adjustment_surplus_rehearsal");
  if (result?.result !== "STAGING_ADJUSTMENT_SURPLUS_REHEARSAL_OK" || result.rolled_back !== true
      || Number(result.debit) !== 40 || Number(result.credit) !== 40) throw new Error(`نتيجة التجربة غير سليمة: ${dir}`);
  const after = validateBaseline(extract(runCli(baselineSql, "baseline-after", dir), "adjustment_surplus_baseline"));
  assertSame(after, expected, "بعد الرجوع", dir);
  writeFileSync(join(dir, "report.json"), `${JSON.stringify({ ...result, projectRef, baselineRestored: true,
    productionModified: false, createdAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجحت تجربة فائض المخزون على Staging داخل معاملة انتهت بـ ROLLBACK كامل");
  console.log("الخطة متوازنة: 1104 مدين 40، و4201 دائن 40؛ عادت بيانات الأعمال إلى خط الأساس");
  console.log(`REPORT_DIR=${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
