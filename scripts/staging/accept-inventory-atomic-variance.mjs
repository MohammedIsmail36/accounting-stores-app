// Transaction-only acceptance on Staging: shortage, costed surplus, no-cost refusal.
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStagingLink, queryBaseline, stableBaseline, validateBaseline } from "./backup-inventory-atomic-variance-baseline.mjs";
import { beginSql, names, runQuery, sourceSql } from "./rehearse-inventory-atomic-variance.mjs";

function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function compareBaseline(expected, log, phase) {
  const actual = queryBaseline(log);
  if (JSON.stringify(stableBaseline(actual)) !== JSON.stringify(stableBaseline(expected))) {
    throw new Error(`تغير خط أساس Staging ${phase}؛ أُلغي اختبار القبول`);
  }
}

export function acceptanceSql() {
  const migrations = names.map((name) => sourceSql("migrations", name)).join("\n");
  return `${beginSql()}
${migrations}

-- Candidates were checked read-only before this test. Revalidate their state
-- under the same transaction so no fixture silently uses another stock state.
DO $candidates$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE code='PRD-004'
      AND is_active AND quantity_on_hand=3)
     OR NOT EXISTS (SELECT 1 FROM public.products WHERE code='PRD-005'
      AND is_active AND quantity_on_hand=2)
     OR NOT EXISTS (SELECT 1 FROM public.products WHERE code='PRD-001'
      AND is_active AND quantity_on_hand=0) THEN
    RAISE EXCEPTION 'STAGING_ATOMIC_VARIANCE_CANDIDATES_CHANGED';
  END IF;
END $candidates$;

-- Shortage creates a posted journal and movement, then a reversing journal
-- and movement. Repeated requests must never create a second effect.
DO $shortage$
DECLARE d uuid:=gen_random_uuid(); p uuid; q numeric; request uuid:=gen_random_uuid();
  result jsonb; reverse_result jsonb; operation uuid; journal uuid; diagnostic jsonb;
BEGIN
  SELECT id, quantity_on_hand INTO STRICT p,q FROM public.products WHERE code='PRD-004';
  INSERT INTO public.inventory_adjustments(id,adjustment_date,status)
    VALUES(d,CURRENT_DATE,'draft');
  INSERT INTO public.inventory_adjustment_items(
    adjustment_id,product_id,system_quantity,actual_quantity,difference,notes)
    VALUES(d,p,q,q-1,-1,'اختبار قبول العجز المعاملاتي');
  result:=public.post_inventory_adjustment_atomic(d,request);
  operation:=(result->>'operation_id')::uuid;
  journal:=(result->>'journal_entry_id')::uuid;
  IF journal IS NULL OR (SELECT status FROM public.inventory_adjustments WHERE id=d)<>'posted'
     OR (SELECT quantity_on_hand FROM public.products WHERE id=p)<>q-1
     OR (SELECT posted_number FROM public.journal_entries WHERE id=journal) IS NULL
     OR (SELECT count(*) FROM public.inventory_movements WHERE variance_operation_id=operation)<>1
     OR (SELECT count(*) FROM public.journal_entry_lines WHERE journal_entry_id=journal)<>2
     OR NOT EXISTS (SELECT 1 FROM public.journal_entry_lines l JOIN public.accounts a ON a.id=l.account_id
       WHERE l.journal_entry_id=journal AND a.code='5201' AND l.debit>0)
     OR NOT EXISTS (SELECT 1 FROM public.journal_entry_lines l JOIN public.accounts a ON a.id=l.account_id
       WHERE l.journal_entry_id=journal AND a.code='1104' AND l.credit>0)
  THEN RAISE EXCEPTION 'STAGING_SHORTAGE_POST_FAILED'; END IF;
  result:=public.post_inventory_adjustment_atomic(d,request);
  IF (result->>'repeated')::boolean IS NOT TRUE OR (result->>'operation_id')::uuid<>operation
  THEN RAISE EXCEPTION 'STAGING_SHORTAGE_IDEMPOTENCE_FAILED'; END IF;
  diagnostic:=public.get_inventory_reconciliation_diagnostic('summary',true,NULL,100,0,NULL);
  IF diagnostic->>'status'<>'rounding_only'
     OR (diagnostic->'totals'->>'movement_to_ledger_difference')::numeric<>0.02
  THEN RAISE EXCEPTION 'STAGING_SHORTAGE_DIAGNOSTIC_CHANGED'; END IF;
  reverse_result:=public.reverse_inventory_adjustment_atomic(d,gen_random_uuid(),'عكس اختبار القبول');
  IF (SELECT status FROM public.inventory_adjustments WHERE id=d)<>'cancelled'
     OR (SELECT quantity_on_hand FROM public.products WHERE id=p)<>q
     OR (SELECT count(*) FROM public.inventory_variance_operations WHERE source_id=d)<>2
     OR (SELECT count(*) FROM public.inventory_movements WHERE reference_id=d)<>2
     OR (SELECT posted_number FROM public.journal_entries
       WHERE id=(reverse_result->>'journal_entry_id')::uuid) IS NULL
  THEN RAISE EXCEPTION 'STAGING_SHORTAGE_REVERSE_FAILED'; END IF;
  diagnostic:=public.get_inventory_reconciliation_diagnostic('summary',true,NULL,100,0,NULL);
  IF diagnostic->>'status'<>'rounding_only'
     OR (diagnostic->'totals'->>'movement_to_ledger_difference')::numeric<>0.02
  THEN RAISE EXCEPTION 'STAGING_SHORTAGE_REVERSE_DIAGNOSTIC_CHANGED'; END IF;
END $shortage$;

-- Existing positive stock provides a traceable movement-book cost for surplus.
DO $surplus$
DECLARE d uuid:=gen_random_uuid(); p uuid; q numeric; result jsonb; reverse_result jsonb; journal uuid;
BEGIN
  SELECT id,quantity_on_hand INTO STRICT p,q FROM public.products WHERE code='PRD-005';
  INSERT INTO public.inventory_adjustments(id,adjustment_date,status)
    VALUES(d,CURRENT_DATE,'draft');
  INSERT INTO public.inventory_adjustment_items(
    adjustment_id,product_id,system_quantity,actual_quantity,difference,notes)
    VALUES(d,p,q,q+1,1,'اختبار قبول فائض بتكلفة دفترية موثوقة');
  result:=public.post_inventory_adjustment_atomic(d,gen_random_uuid());
  journal:=(result->>'journal_entry_id')::uuid;
  IF (SELECT quantity_on_hand FROM public.products WHERE id=p)<>q+1
     OR (SELECT posted_number FROM public.journal_entries WHERE id=journal) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.inventory_variance_operation_lines l
       JOIN public.inventory_variance_operations o ON o.id=l.operation_id
       WHERE o.source_id=d AND o.operation_kind='post' AND l.cost_source='movement_book_value')
     OR NOT EXISTS (SELECT 1 FROM public.journal_entry_lines l JOIN public.accounts a ON a.id=l.account_id
       WHERE l.journal_entry_id=journal AND a.code='1104' AND l.debit>0)
     OR NOT EXISTS (SELECT 1 FROM public.journal_entry_lines l JOIN public.accounts a ON a.id=l.account_id
       WHERE l.journal_entry_id=journal AND a.code='4201' AND l.credit>0)
  THEN RAISE EXCEPTION 'STAGING_SURPLUS_POST_FAILED'; END IF;
  reverse_result:=public.reverse_inventory_adjustment_atomic(d,gen_random_uuid(),'عكس فائض اختبار القبول');
  IF (SELECT quantity_on_hand FROM public.products WHERE id=p)<>q
     OR (SELECT status FROM public.inventory_adjustments WHERE id=d)<>'cancelled'
     OR (SELECT posted_number FROM public.journal_entries
       WHERE id=(reverse_result->>'journal_entry_id')::uuid) IS NULL
  THEN RAISE EXCEPTION 'STAGING_SURPLUS_REVERSE_FAILED'; END IF;
END $surplus$;

-- At zero stock with no trusted purchase movement, surplus must be rejected
-- without any movement, journal, operation or product-quantity change.
DO $no_cost$
DECLARE d uuid:=gen_random_uuid(); p uuid; error_message text;
BEGIN
  SELECT id INTO STRICT p FROM public.products WHERE code='PRD-001';
  IF EXISTS (SELECT 1 FROM public.inventory_movements
    WHERE product_id=p AND movement_type='purchase' AND quantity<>0 AND total_cost>0) THEN
    RAISE EXCEPTION 'STAGING_NO_COST_CANDIDATE_HAS_PURCHASE';
  END IF;
  INSERT INTO public.inventory_adjustments(id,adjustment_date,status)
    VALUES(d,CURRENT_DATE,'draft');
  INSERT INTO public.inventory_adjustment_items(
    adjustment_id,product_id,system_quantity,actual_quantity,difference,notes)
    VALUES(d,p,0,1,1,'اختبار رفض فائض بلا تكلفة');
  BEGIN
    PERFORM public.post_inventory_adjustment_atomic(d,gen_random_uuid());
    RAISE EXCEPTION 'STAGING_NO_COST_REJECTION_MISSING';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_message=MESSAGE_TEXT;
    IF error_message<>'INVENTORY_VARIANCE_COST_REQUIRED' THEN RAISE; END IF;
  END;
  IF (SELECT quantity_on_hand FROM public.products WHERE id=p)<>0
     OR (SELECT status FROM public.inventory_adjustments WHERE id=d)<>'draft'
     OR EXISTS (SELECT 1 FROM public.inventory_variance_operations WHERE source_id=d)
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE reference_id=d)
  THEN RAISE EXCEPTION 'STAGING_NO_COST_PARTIAL_EFFECT'; END IF;
END $no_cost$;

SELECT 'STAGING_ATOMIC_VARIANCE_ACCEPTANCE_OK' AS result;
ROLLBACK;`;
}

function main() {
  if (process.argv.length!==3) throw new Error("الاستخدام: node accept-inventory-atomic-variance.mjs ARCHIVE_DIR");
  assertStagingLink();
  const archive=realpathSync(process.argv[2]);
  if (!archive.startsWith("/backups/staging/inventory-atomic-variance-before-")) {
    throw new Error("مسار النسخة الاحتياطية غير متوقع");
  }
  const checksums=readFileSync(join(archive,"SHA256SUMS"),"utf8").trim().split("\n");
  for (const line of checksums) {
    const match=/^([a-f0-9]{64})  ([a-z.-]+)$/.exec(line);
    if (!match || sha256(join(archive,match[2]))!==match[1]) throw new Error("بصمة النسخة الاحتياطية غير صحيحة");
  }
  const expected=validateBaseline(JSON.parse(readFileSync(join(archive,"baseline.json"),"utf8")));
  process.umask(0o077);
  const dir=mkdtempSync(join(archive,"transactional-acceptance-"));
  chmodSync(dir,0o700);
  const log=join(dir,"run.log");
  compareBaseline(expected,log,"قبل اختبار القبول");
  const output=runQuery(acceptanceSql(),"acceptance",dir);
  if (!output.includes("STAGING_ATOMIC_VARIANCE_ACCEPTANCE_OK")) {
    throw new Error("علامة نجاح اختبار القبول غير موجودة");
  }
  compareBaseline(expected,log,"بعد الرجوع الكامل");
  const report=join(dir,"report.json");
  writeFileSync(report,`${JSON.stringify({
    result:"STAGING_ATOMIC_VARIANCE_ACCEPTANCE_OK",
    createdAt:new Date().toISOString(),
    archive,
    scenarios:["shortage_post_reverse_idempotence","costed_surplus_post_reverse","no_cost_surplus_rejected"],
    transactionRolledBack:true,
    baselineUnchanged:true,
    productionModified:false,
  },null,2)}\n`,{mode:0o600});
  writeFileSync(join(dir,"SHA256SUMS"),`${[join(dir,"acceptance.sql"),report]
    .map((path)=>`${sha256(path)}  ${path.split("/").at(-1)}`).join("\n")}\n`,{mode:0o600});
  console.log("نجح اختبار العجز والفائض الموثوق وعكسهما ورفض الفائض بلا تكلفة على Staging داخل ROLLBACK كامل");
  console.log("تطابق خط الأساس بعد التجربة؛ لم تُطبّق الترحيلات أو تُنشر الواجهة");
  console.log(`REPORT_DIR=${dir}`);
}

if (process.argv[1]===fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode=1; }
}
