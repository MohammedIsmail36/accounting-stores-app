// Phase 4A Staging gate: migration, draft create/edit and explicit rollback
// inside a single transaction. Never leaves a draft or schema change behind.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStagingLink, queryState, stableBaseline } from './backup-inventory-atomic-variance-baseline.mjs';

const root='/opt/accounting-app';
const backup='/backups/staging/inventory-draft-save-before-JEpdCX';
const migration=join(root,'supabase/migrations/20260925100000_inventory_adjustment_atomic_draft_save.sql');
const rollback=join(root,'supabase/rollback/20260925100000_inventory_adjustment_atomic_draft_save.sql');
const expected=JSON.parse(readFileSync(join(backup,'baseline.json'),'utf8'));
const same=(a,b)=>JSON.stringify(stableBaseline(a))===JSON.stringify(stableBaseline(b));
assertStagingLink();
process.umask(0o077);
const dir=mkdtempSync('/tmp/accounting-staging-inventory-draft-save-rehearsal-');
chmodSync(dir,0o700);
const before=queryState(join(dir,'baseline-before.log'));
if(!same(before,expected)) throw new Error(`تغيرت Staging منذ النسخة؛ أُلغيت التجربة: ${dir}`);

const sql=`BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
${readFileSync(migration,'utf8')}
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $test$
DECLARE
  v_product uuid;
  v_quantity numeric;
  v_payload jsonb;
  v_result jsonb;
  v_id uuid;
  v_message text;
BEGIN
  IF current_database()<>'postgres' OR current_setting('server_version') NOT LIKE '17.%' THEN
    RAISE EXCEPTION 'STAGING_DRAFT_SAVE_IDENTITY_MISMATCH';
  END IF;
  SELECT id,quantity_on_hand INTO v_product,v_quantity FROM public.products
  WHERE is_active ORDER BY id LIMIT 1 FOR SHARE;
  IF v_product IS NULL THEN RAISE EXCEPTION 'STAGING_DRAFT_SAVE_PRODUCT_MISSING'; END IF;
  v_payload:=jsonb_build_array(jsonb_build_object('product_id',v_product,
    'system_quantity',v_quantity,'actual_quantity',v_quantity,'unit_cost',1,'notes','تجربة معاملاتية'));
  v_result:=public.save_inventory_adjustment_draft(NULL,NULL,CURRENT_DATE,
    'تجربة حفظ مسودة قابلة للرجوع',v_payload);
  v_id:=(v_result->>'adjustment_id')::uuid;
  IF v_id IS NULL OR (SELECT count(*) FROM public.inventory_adjustment_items WHERE adjustment_id=v_id)<>1
    OR (SELECT status FROM public.inventory_adjustments WHERE id=v_id)<>'draft' THEN
    RAISE EXCEPTION 'STAGING_DRAFT_SAVE_CREATE_FAILED';
  END IF;
  v_result:=public.save_inventory_adjustment_draft(v_id,(v_result->>'updated_at')::timestamptz,
    CURRENT_DATE,'تعديل معاملاتى',v_payload);
  IF (SELECT description FROM public.inventory_adjustments WHERE id=v_id)<>'تعديل معاملاتى' THEN
    RAISE EXCEPTION 'STAGING_DRAFT_SAVE_EDIT_FAILED';
  END IF;
  BEGIN
    PERFORM public.save_inventory_adjustment_draft(v_id,
      (v_result->>'updated_at')::timestamptz,CURRENT_DATE,'منتج مكرر',v_payload || v_payload);
    RAISE EXCEPTION 'STAGING_DRAFT_SAVE_DUPLICATE_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message<>'INVENTORY_DRAFT_DUPLICATE_PRODUCT' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.inventory_adjustment_items WHERE adjustment_id=v_id)<>1 THEN
    RAISE EXCEPTION 'STAGING_DRAFT_SAVE_PARTIAL_WRITE';
  END IF;
END;
$test$;
${readFileSync(rollback,'utf8')}
DO $verify$ BEGIN
  IF to_regprocedure('public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'STAGING_DRAFT_SAVE_EXPLICIT_ROLLBACK_FAILED';
  END IF;
END $verify$;
SELECT 'STAGING_DRAFT_SAVE_TRANSACTIONAL_REHEARSAL_OK';
ROLLBACK;
`;
const sqlPath=join(dir,'rehearsal.sql');
writeFileSync(sqlPath,sql,{mode:0o600});
const result=spawnSync('npx',['-y','supabase@2.116.0','db','query','--linked',
  '--output-format','json','--file',sqlPath],{
    cwd:root,encoding:'utf8',timeout:300000,maxBuffer:64*1024*1024,
  });
writeFileSync(join(dir,'run.log'),`${result.stdout??''}\n${result.stderr??''}\n${result.error?.message??''}\n`,{mode:0o600});
if(result.error || result.status!==0 || !result.stdout.includes('STAGING_DRAFT_SAVE_TRANSACTIONAL_REHEARSAL_OK')) {
  throw new Error(`فشلت تجربة حفظ المسودة على Staging؛ التشخيص: ${dir}/run.log`);
}
const after=queryState(join(dir,'baseline-after.log'));
assert.ok(same(after,expected),`لم تعد Staging إلى خط الأساس: ${dir}`);
writeFileSync(join(dir,'report.json'),`${JSON.stringify({
  result:'STAGING_DRAFT_SAVE_TRANSACTIONAL_REHEARSAL_OK',
  backup,createdAt:new Date().toISOString(),
  migrationRolledBack:true,draftRolledBack:true,businessBaselinePreserved:true,
},null,2)}\n`,{mode:0o600});
console.log('نجحت تجربة حفظ مسودة التسوية على Staging داخل معاملة أعيد عنها بالكامل');
console.log(`REPORT_DIR=${dir}`);
