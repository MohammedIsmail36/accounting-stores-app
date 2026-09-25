// Phase 4B Staging gate: migration and draft deletion inside one ROLLBACK.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStagingLink, queryState, stableBaseline } from './backup-inventory-atomic-variance-baseline.mjs';

const root='/opt/accounting-app';
const backup=process.argv[2];
assert.ok(backup?.startsWith('/backups/staging/inventory-draft-delete-before-'),
  'حدد مسار نسخة Staging الحديثة');
const migration=join(root,'supabase/migrations/20260925110000_inventory_adjustment_atomic_draft_delete.sql');
const rollback=join(root,'supabase/rollback/20260925110000_inventory_adjustment_atomic_draft_delete.sql');
const expected=JSON.parse(readFileSync(join(backup,'baseline.json'),'utf8'));
const same=(a,b)=>JSON.stringify(stableBaseline(a))===JSON.stringify(stableBaseline(b));
assertStagingLink();
process.umask(0o077);
const dir=mkdtempSync('/tmp/accounting-staging-inventory-draft-delete-rehearsal-');
chmodSync(dir,0o700);
const before=queryState(join(dir,'baseline-before.log'));
if(!same(before,expected)) throw new Error(`تغيرت Staging منذ النسخة؛ أُلغيت التجربة: ${dir}`);

const sql=`BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
${readFileSync(migration,'utf8')}
DO $test$
DECLARE
  v_admin uuid;
  v_sales uuid;
  v_product uuid;
  v_quantity numeric;
  v_id uuid;
  v_result jsonb;
  v_message text;
BEGIN
  IF current_database()<>'postgres' OR current_setting('server_version') NOT LIKE '17.%'
     OR has_table_privilege('authenticated','public.inventory_adjustments','DELETE')
     OR has_table_privilege('authenticated','public.inventory_adjustment_items','DELETE') THEN
    RAISE EXCEPTION 'STAGING_DRAFT_DELETE_IDENTITY_OR_ACL_MISMATCH';
  END IF;
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role='admin' LIMIT 1;
  SELECT user_id INTO v_sales FROM public.user_roles WHERE role='sales' LIMIT 1;
  SELECT id,quantity_on_hand INTO v_product,v_quantity FROM public.products
    WHERE is_active ORDER BY id LIMIT 1 FOR SHARE;
  IF v_admin IS NULL OR v_sales IS NULL OR v_product IS NULL THEN
    RAISE EXCEPTION 'STAGING_DRAFT_DELETE_FIXTURE_MISSING';
  END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  v_result:=public.save_inventory_adjustment_draft(NULL,NULL,CURRENT_DATE,
    'تجربة حذف معاملاتية',jsonb_build_array(jsonb_build_object(
      'product_id',v_product,'system_quantity',v_quantity,
      'actual_quantity',v_quantity,'unit_cost',1,'notes','تجربة')));
  v_id:=(v_result->>'adjustment_id')::uuid;
  PERFORM set_config('request.jwt.claim.sub',v_sales::text,true);
  BEGIN
    PERFORM public.delete_inventory_adjustment_draft(v_id,(v_result->>'updated_at')::timestamptz);
    RAISE EXCEPTION 'STAGING_DRAFT_DELETE_SALES_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message<>'INVENTORY_DRAFT_DELETE_PERMISSION_DENIED' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  BEGIN
    PERFORM public.delete_inventory_adjustment_draft(v_id,
      (v_result->>'updated_at')::timestamptz - interval '1 second');
    RAISE EXCEPTION 'STAGING_DRAFT_DELETE_STALE_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message<>'INVENTORY_DRAFT_DELETE_VERSION_CHANGED' THEN RAISE; END IF;
  END;
  PERFORM public.delete_inventory_adjustment_draft(v_id,(v_result->>'updated_at')::timestamptz);
  IF EXISTS (SELECT 1 FROM public.inventory_adjustments WHERE id=v_id)
     OR EXISTS (SELECT 1 FROM public.inventory_adjustment_items WHERE adjustment_id=v_id) THEN
    RAISE EXCEPTION 'STAGING_DRAFT_DELETE_CASCADE_FAILED';
  END IF;
END;
$test$;
${readFileSync(rollback,'utf8')}
DO $verify$ BEGIN
  IF to_regprocedure('public.delete_inventory_adjustment_draft(uuid,timestamptz)') IS NOT NULL
     OR NOT has_table_privilege('authenticated','public.inventory_adjustments','DELETE')
     OR NOT has_table_privilege('authenticated','public.inventory_adjustment_items','DELETE') THEN
    RAISE EXCEPTION 'STAGING_DRAFT_DELETE_EXPLICIT_ROLLBACK_FAILED';
  END IF;
END $verify$;
SELECT 'STAGING_DRAFT_DELETE_TRANSACTIONAL_REHEARSAL_OK';
ROLLBACK;
`;
const sqlPath=join(dir,'rehearsal.sql');
writeFileSync(sqlPath,sql,{mode:0o600});
const result=spawnSync('npx',['-y','supabase@2.116.0','db','query','--linked',
  '--output-format','json','--file',sqlPath],{
    cwd:root,encoding:'utf8',timeout:300000,maxBuffer:64*1024*1024,
  });
writeFileSync(join(dir,'run.log'),`${result.stdout??''}\n${result.stderr??''}\n${result.error?.message??''}\n`,{mode:0o600});
if(result.error || result.status!==0 || !result.stdout.includes('STAGING_DRAFT_DELETE_TRANSACTIONAL_REHEARSAL_OK')) {
  throw new Error(`فشلت تجربة حذف المسودة على Staging؛ التشخيص: ${dir}/run.log`);
}
const after=queryState(join(dir,'baseline-after.log'));
assert.ok(same(after,expected),`لم تعد Staging إلى خط الأساس: ${dir}`);
writeFileSync(join(dir,'report.json'),`${JSON.stringify({
  result:'STAGING_DRAFT_DELETE_TRANSACTIONAL_REHEARSAL_OK',
  backup,createdAt:new Date().toISOString(),migrationRolledBack:true,
  draftRolledBack:true,businessBaselinePreserved:true,
},null,2)}\n`,{mode:0o600});
console.log('نجحت تجربة حذف المسودة على Staging داخل معاملة أعيد عنها بالكامل');
console.log(`REPORT_DIR=${dir}`);
