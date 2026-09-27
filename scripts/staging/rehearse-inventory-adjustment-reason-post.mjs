// Transactional Staging acceptance for a categorized inventory adjustment.
// The test document is not kept; business rows must match the frozen backup.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStagingLink, queryState, stableBaseline } from './backup-inventory-atomic-variance-baseline.mjs';

const root = '/opt/accounting-app';
const backup = process.argv[2];
if (!backup?.startsWith('/backups/staging/inventory-adjustment-reason-post-before-')) {
  throw new Error('حدد نسخة Staging الحديثة المعتمدة قبل تجربة الترحيل');
}
assertStagingLink();
const expected = JSON.parse(readFileSync(join(backup, 'baseline.json'), 'utf8'));
assert.equal(expected.preflight?.draft34?.status, 'draft');
process.umask(0o077);
const dir = mkdtempSync('/tmp/accounting-staging-reason-post-rehearsal-');
chmodSync(dir, 0o700);
const before = stableBaseline(queryState(join(dir, 'baseline-before.log')));
assert.deepEqual(before, expected.baseline, `تغيرت Staging منذ النسخة؛ أُلغيت التجربة: ${dir}`);

const sql = `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
DO $reason_post$
DECLARE
  v_admin uuid;
  v_product uuid;
  v_quantity numeric;
  v_book numeric;
  v_id uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_result jsonb;
  v_journal uuid;
  v_before_1104 numeric;
  v_after_1104 numeric;
  v_before_movements bigint;
  v_before_journals bigint;
  v_before_lines bigint;
BEGIN
  IF current_database() <> 'postgres'
      OR current_setting('server_version') NOT LIKE '17.%'
      OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
        WHERE version='20260925120000') THEN
    RAISE EXCEPTION 'STAGING_REASON_POST_IDENTITY_MISMATCH';
  END IF;
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role='admin' LIMIT 1;
  SELECT id, quantity_on_hand INTO v_product, v_quantity
    FROM public.products WHERE code='TST-2D-SI-001' AND is_active FOR UPDATE;
  SELECT COALESCE(sum(CASE
      WHEN m.movement_type::text='adjustment' THEN sign(m.quantity)*abs(m.total_cost)
      WHEN m.movement_type::text IN ('sale','purchase_return') THEN -abs(m.total_cost)
      ELSE abs(m.total_cost) END),0)
    INTO v_book FROM public.inventory_movements m WHERE m.product_id=v_product;
  IF v_admin IS NULL OR v_product IS NULL OR v_quantity <> 8 OR v_book <> 320
      OR EXISTS (SELECT 1 FROM public.inventory_adjustments WHERE adjustment_number=-900001)
      OR EXISTS (SELECT 1 FROM public.inventory_adjustment_items i
        JOIN public.inventory_adjustments a ON a.id=i.adjustment_id
        WHERE i.product_id=v_product AND a.status='draft') THEN
    RAISE EXCEPTION 'STAGING_REASON_POST_CANDIDATE_CHANGED';
  END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  SELECT COALESCE(sum(l.debit-l.credit),0) INTO v_before_1104
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id=l.journal_entry_id
    JOIN public.accounts a ON a.id=l.account_id
    WHERE a.code='1104' AND j.status='posted';
  SELECT count(*) INTO v_before_movements FROM public.inventory_movements;
  SELECT count(*) INTO v_before_journals FROM public.journal_entries;
  SELECT count(*) INTO v_before_lines FROM public.journal_entry_lines;
  INSERT INTO public.inventory_adjustments(
    id,adjustment_number,adjustment_date,description,status,created_by)
    VALUES(v_id,-900001,CURRENT_DATE,'اختبار معاملات أسباب الفرق','draft',v_admin);
  INSERT INTO public.inventory_adjustment_items(
    adjustment_id,product_id,system_quantity,actual_quantity,difference,
    unit_cost,total_cost,notes,reason_code)
    VALUES(v_id,v_product,8,9,1,40,40,'كمية اختبار عُثر عليها','found_stock');
  v_result := public.post_inventory_adjustment_atomic(v_id,v_request);
  v_journal := (v_result->>'journal_entry_id')::uuid;
  IF v_result->>'status'<>'posted' OR COALESCE((v_result->>'repeated')::boolean,true)
      OR v_journal IS NULL
      OR (SELECT status FROM public.inventory_adjustments WHERE id=v_id)<>'posted'
      OR (SELECT posted_number FROM public.inventory_adjustments WHERE id=v_id) IS NULL
      OR (SELECT quantity_on_hand FROM public.products WHERE id=v_product)<>9
      OR (SELECT count(*) FROM public.inventory_movements)<>v_before_movements+1
      OR (SELECT count(*) FROM public.journal_entries)<>v_before_journals+1
      OR (SELECT count(*) FROM public.journal_entry_lines)<>v_before_lines+2
      OR (SELECT count(*) FROM public.inventory_movements
          WHERE reference_id=v_id AND product_id=v_product
            AND quantity=1 AND total_cost=40)<>1
      OR (SELECT count(*) FROM public.journal_entry_lines l
          JOIN public.accounts a ON a.id=l.account_id
          WHERE l.journal_entry_id=v_journal
            AND ((a.code='1104' AND l.debit=40 AND l.credit=0)
              OR (a.code='4201' AND l.debit=0 AND l.credit=40)))<>2
      OR (SELECT status FROM public.journal_entries WHERE id=v_journal)<>'posted'
      OR (SELECT count(*) FROM public.inventory_adjustment_items
          WHERE adjustment_id=v_id AND reason_code='found_stock')<>1 THEN
    RAISE EXCEPTION 'STAGING_REASON_POST_EFFECT_MISMATCH';
  END IF;
  SELECT COALESCE(sum(l.debit-l.credit),0) INTO v_after_1104
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id=l.journal_entry_id
    JOIN public.accounts a ON a.id=l.account_id
    WHERE a.code='1104' AND j.status='posted';
  IF v_after_1104-v_before_1104<>40 THEN
    RAISE EXCEPTION 'STAGING_REASON_POST_LEDGER_1104_MISMATCH';
  END IF;
  v_result := public.post_inventory_adjustment_atomic(v_id,v_request);
  IF NOT COALESCE((v_result->>'repeated')::boolean,false)
      OR (v_result->>'journal_entry_id')::uuid<>v_journal
      OR (SELECT count(*) FROM public.inventory_movements)<>v_before_movements+1 THEN
    RAISE EXCEPTION 'STAGING_REASON_POST_IDEMPOTENCE_FAILED';
  END IF;
END;
$reason_post$;
SELECT 'STAGING_REASON_CODED_POST_TRANSACTION_OK' AS result;
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
    || !result.stdout.includes('STAGING_REASON_CODED_POST_TRANSACTION_OK')) {
  throw new Error(`فشلت تجربة ترحيل السبب؛ التشخيص المحمي: ${dir}/run.log`);
}
const after = stableBaseline(queryState(join(dir, 'baseline-after.log')));
assert.deepEqual(after, expected.baseline, `لم تعد بيانات Staging إلى خط الأساس: ${dir}`);
writeFileSync(join(dir, 'report.json'), `${JSON.stringify({
  result: 'STAGING_REASON_CODED_POST_TRANSACTION_OK',
  backup, candidate: 'TST-2D-SI-001', reason: 'found_stock',
  businessRowsRestored: true, draft34Preserved: true,
  tested: ['quantity', 'movement', 'journal', 'account_1104', 'idempotence'],
  verifiedAt: new Date().toISOString(),
}, null, 2)}\n`, { mode: 0o600 });
console.log('نجحت تجربة ترحيل سبب التسوية داخل معاملة انتهت بـ ROLLBACK');
console.log('الكمية والحركة والقيد و1104 والتكرار سليمة؛ صفوف Staging مطابقة للنسخة');
console.log(`REPORT_DIR=${dir}`);
