// Phase 4C Staging rehearsal: migration, real-data smoke, explicit rollback,
// and final transaction rollback. No schema or business row survives.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStagingLink, queryState, stableBaseline } from './backup-inventory-atomic-variance-baseline.mjs';

const root = '/opt/accounting-app';
const backup = process.argv[2];
if (!backup?.startsWith('/backups/staging/inventory-adjustment-reasons-before-')) {
  throw new Error('حدد نسخة أسباب التسوية المعتمدة قبل التجربة');
}
const migration = join(root,'supabase/migrations/20260925120000_inventory_adjustment_reason_codes.sql');
const rollback = join(root,'supabase/rollback/20260925120000_inventory_adjustment_reason_codes.sql');
const contract = join(root,'supabase/tests/inventory_adjustment_reason_codes_contract.sql');
const expected = JSON.parse(readFileSync(join(backup,'baseline.json'),'utf8'));
const same = (a,b) => JSON.stringify(stableBaseline(a)) === JSON.stringify(stableBaseline(b));
assertStagingLink();
process.umask(0o077);
const dir = mkdtempSync('/tmp/accounting-staging-adjustment-reasons-rehearsal-');
chmodSync(dir,0o700);
const before = queryState(join(dir,'baseline-before.log'));
if (!same(before,expected)) throw new Error(`تغيرت Staging منذ النسخة؛ ألغيت التجربة: ${dir}`);

const sql = `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
${readFileSync(migration,'utf8')}
${readFileSync(contract,'utf8')}
DO $test$
DECLARE
  v_admin uuid;
  v_product uuid;
  v_quantity numeric;
  v_payload jsonb;
  v_result jsonb;
  v_id uuid;
  v_old_id uuid;
  v_message text;
BEGIN
  IF current_database()<>'postgres' OR current_setting('server_version') NOT LIKE '17.%' THEN
    RAISE EXCEPTION 'STAGING_ADJUSTMENT_REASON_IDENTITY_MISMATCH';
  END IF;
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role='admin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'STAGING_ADJUSTMENT_REASON_ADMIN_MISSING'; END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  SELECT id,quantity_on_hand INTO v_product,v_quantity FROM public.products
  WHERE is_active ORDER BY id LIMIT 1 FOR SHARE;
  IF v_product IS NULL THEN RAISE EXCEPTION 'STAGING_ADJUSTMENT_REASON_PRODUCT_MISSING'; END IF;
  v_payload:=jsonb_build_array(jsonb_build_object('product_id',v_product,
    'system_quantity',v_quantity,'actual_quantity',v_quantity+1,'unit_cost',1,
    'notes','تجربة معاملاتية','reason_code','found_stock'));
  v_result:=public.save_inventory_adjustment_draft_with_reasons(NULL,NULL,CURRENT_DATE,
    'تجربة أسباب قابلة للرجوع',v_payload);
  v_id:=(v_result->>'adjustment_id')::uuid;
  IF v_id IS NULL OR (SELECT reason_code FROM public.inventory_adjustment_items
      WHERE adjustment_id=v_id)<>'found_stock' THEN
    RAISE EXCEPTION 'STAGING_ADJUSTMENT_REASON_SAVE_FAILED';
  END IF;
  BEGIN
    PERFORM public.save_inventory_adjustment_draft_with_reasons(v_id,
      (v_result->>'updated_at')::timestamptz,CURRENT_DATE,'رمز مرفوض',
      jsonb_build_array(jsonb_set(v_payload->0,'{reason_code}','"unknown"'::jsonb)));
    RAISE EXCEPTION 'STAGING_ADJUSTMENT_REASON_INVALID_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message<>'INVENTORY_DRAFT_REASON_INVALID' THEN RAISE; END IF;
  END;
  v_result:=public.save_inventory_adjustment_draft(NULL,NULL,CURRENT_DATE,
    'عميل قديم',jsonb_build_array((v_payload->0)-'reason_code'));
  v_old_id:=(v_result->>'adjustment_id')::uuid;
  BEGIN
    UPDATE public.inventory_adjustments SET status='posted' WHERE id=v_old_id;
    RAISE EXCEPTION 'STAGING_ADJUSTMENT_REASON_OLD_POST_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message<>'INVENTORY_VARIANCE_REASON_CODE_REQUIRED' THEN RAISE; END IF;
  END;
  DELETE FROM public.inventory_adjustments WHERE id IN (v_id,v_old_id);
END;
$test$;
${readFileSync(rollback,'utf8')}
DO $verify$ BEGIN
  IF to_regprocedure('public.save_inventory_adjustment_draft_with_reasons(uuid,timestamptz,date,text,jsonb)') IS NOT NULL
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='inventory_adjustment_items' AND column_name='reason_code') THEN
    RAISE EXCEPTION 'STAGING_ADJUSTMENT_REASON_ROLLBACK_FAILED';
  END IF;
END $verify$;
SELECT 'STAGING_ADJUSTMENT_REASONS_TRANSACTIONAL_REHEARSAL_OK';
ROLLBACK;
`;
const sqlPath = join(dir,'rehearsal.sql');
writeFileSync(sqlPath,sql,{mode:0o600});
const result = spawnSync('npx',['-y','supabase@2.116.0','db','query','--linked',
  '--output-format','json','--file',sqlPath],{
  cwd:root,encoding:'utf8',timeout:300000,maxBuffer:64*1024*1024,
});
writeFileSync(join(dir,'run.log'),`${result.stdout??''}\n${result.stderr??''}\n${result.error?.message??''}\n`,{mode:0o600});
if(result.error || result.status!==0
  || !result.stdout.includes('STAGING_ADJUSTMENT_REASONS_TRANSACTIONAL_REHEARSAL_OK')) {
  throw new Error(`فشلت تجربة أسباب التسوية على Staging؛ التشخيص: ${dir}/run.log`);
}
const after = queryState(join(dir,'baseline-after.log'));
assert.ok(same(after,expected),`لم تعد Staging إلى خط الأساس: ${dir}`);
writeFileSync(join(dir,'report.json'),`${JSON.stringify({
  result:'STAGING_ADJUSTMENT_REASONS_TRANSACTIONAL_REHEARSAL_OK',
  backup,createdAt:new Date().toISOString(),
  migrationRolledBack:true,fixturesRolledBack:true,businessBaselinePreserved:true,
},null,2)}\n`,{mode:0o600});
console.log('نجحت تجربة أسباب فرق التسوية على Staging داخل معاملة أعيد عنها بالكامل');
console.log(`REPORT_DIR=${dir}`);
