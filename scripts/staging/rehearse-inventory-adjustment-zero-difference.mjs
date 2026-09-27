// Staging Phase 4 zero-difference acceptance, rolled back in full.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStagingLink, queryState, stableBaseline } from './backup-inventory-atomic-variance-baseline.mjs';

const root = '/opt/accounting-app';
const backup = process.argv[2];
if (!backup?.startsWith('/backups/staging/inventory-adjustment-reason-post-before-')) {
  throw new Error('حدد نسخة Staging المعتمدة قبل اختبار الفرق الصفري');
}
assertStagingLink();
const expected = JSON.parse(readFileSync(join(backup, 'baseline.json'), 'utf8'));
process.umask(0o077);
const dir = mkdtempSync('/tmp/accounting-staging-adjustment-zero-difference-');
chmodSync(dir, 0o700);
assert.deepEqual(stableBaseline(queryState(join(dir, 'baseline-before.log'))),
  expected.baseline, `تغيرت Staging منذ النسخة؛ أُلغي الاختبار: ${dir}`);

const sql = `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
DO $zero$
DECLARE
  v_admin uuid;
  v_product uuid;
  v_quantity numeric;
  v_id uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_result jsonb;
  v_before_movements bigint;
  v_before_journals bigint;
  v_before_lines bigint;
BEGIN
  IF current_database()<>'postgres' OR current_setting('server_version') NOT LIKE '17.%'
      OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
        WHERE version='20260925120000') THEN
    RAISE EXCEPTION 'STAGING_ZERO_IDENTITY_MISMATCH';
  END IF;
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role='admin' LIMIT 1;
  SELECT id,quantity_on_hand INTO v_product,v_quantity FROM public.products
    WHERE code='TST-2D-SI-001' AND is_active FOR UPDATE;
  IF v_admin IS NULL OR v_product IS NULL OR v_quantity<>8
      OR EXISTS(SELECT 1 FROM public.inventory_adjustments WHERE adjustment_number=-900002) THEN
    RAISE EXCEPTION 'STAGING_ZERO_CANDIDATE_CHANGED';
  END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  SELECT count(*) INTO v_before_movements FROM public.inventory_movements;
  SELECT count(*) INTO v_before_journals FROM public.journal_entries;
  SELECT count(*) INTO v_before_lines FROM public.journal_entry_lines;
  INSERT INTO public.inventory_adjustments(
    id,adjustment_number,adjustment_date,description,status,created_by)
    VALUES(v_id,-900002,CURRENT_DATE,'اختبار فرق صفر','draft',v_admin);
  INSERT INTO public.inventory_adjustment_items(
    adjustment_id,product_id,system_quantity,actual_quantity,difference,
    unit_cost,total_cost,notes,reason_code)
    VALUES(v_id,v_product,8,8,0,40,0,'مطابقة دون فرق',NULL);
  v_result := public.post_inventory_adjustment_atomic(v_id,v_request);
  IF v_result->>'status'<>'posted' OR COALESCE((v_result->>'repeated')::boolean,true)
      OR v_result->>'journal_entry_id' IS NOT NULL
      OR (SELECT status FROM public.inventory_adjustments WHERE id=v_id)<>'posted'
      OR (SELECT posted_number FROM public.inventory_adjustments WHERE id=v_id) IS NULL
      OR (SELECT quantity_on_hand FROM public.products WHERE id=v_product)<>8
      OR (SELECT count(*) FROM public.inventory_movements)<>v_before_movements
      OR (SELECT count(*) FROM public.journal_entries)<>v_before_journals
      OR (SELECT count(*) FROM public.journal_entry_lines)<>v_before_lines
      OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE reference_id=v_id) THEN
    RAISE EXCEPTION 'STAGING_ZERO_CREATED_STOCK_OR_LEDGER_EFFECT';
  END IF;
  v_result := public.post_inventory_adjustment_atomic(v_id,v_request);
  IF NOT COALESCE((v_result->>'repeated')::boolean,false)
      OR v_result->>'journal_entry_id' IS NOT NULL THEN
    RAISE EXCEPTION 'STAGING_ZERO_IDEMPOTENCE_FAILED';
  END IF;
END;
$zero$;
SELECT 'STAGING_ZERO_DIFFERENCE_TRANSACTION_OK' AS result;
ROLLBACK;
`;
const sqlPath = join(dir, 'rehearsal.sql');
writeFileSync(sqlPath, sql, { mode: 0o600 });
const result = spawnSync('npx', ['-y', 'supabase@2.116.0', 'db', 'query', '--linked',
  '--output-format', 'json', '--file', sqlPath], {
  cwd: root, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024,
});
writeFileSync(join(dir, 'run.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.message ?? ''}\n`, { mode: 0o600 });
if (result.error || result.status !== 0
    || !result.stdout.includes('STAGING_ZERO_DIFFERENCE_TRANSACTION_OK')) {
  throw new Error(`فشل اختبار الفرق الصفري؛ التشخيص المحمي: ${dir}/run.log`);
}
assert.deepEqual(stableBaseline(queryState(join(dir, 'baseline-after.log'))),
  expected.baseline, `لم تعد بيانات Staging إلى خط الأساس: ${dir}`);
writeFileSync(join(dir, 'report.json'), `${JSON.stringify({
  result: 'STAGING_ZERO_DIFFERENCE_TRANSACTION_OK', backup,
  candidate: 'TST-2D-SI-001', noMovement: true, noJournal: true,
  productUnchanged: true, draft34Preserved: true, businessRowsRestored: true,
  verifiedAt: new Date().toISOString(),
}, null, 2)}\n`, { mode: 0o600 });
console.log('نجح اختبار الفرق الصفري على Staging داخل معاملة انتهت بـ ROLLBACK');
console.log('لم تُنشأ حركة أو قيد، وبقي المنتج دون تغيير، وعادت صفوف Staging إلى النسخة');
console.log(`REPORT_DIR=${dir}`);
