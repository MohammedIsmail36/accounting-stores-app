// Read-only verification after the Phase 4C Staging migration.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStagingLink, queryState, stableBaseline } from './backup-inventory-atomic-variance-baseline.mjs';

const root='/opt/accounting-app';
const backup=process.argv[2];
if (!backup?.startsWith('/backups/staging/inventory-adjustment-reasons-before-')) {
  throw new Error('حدد نسخة أسباب التسوية المعتمدة');
}
const expected=JSON.parse(readFileSync(join(backup,'baseline.json'),'utf8'));
assertStagingLink();
process.umask(0o077);
const dir=mkdtempSync('/tmp/accounting-staging-adjustment-reasons-postapply-');
chmodSync(dir,0o700);
const sql=`BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
  'database',current_database(),
  'server_version',current_setting('server_version'),
  'migration_present',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20260925120000'),
  'columns',(SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inventory_adjustment_items'
      AND column_name IN ('reason_code','reason_reference') AND data_type='text'),
  'reason_rows',(SELECT count(*) FROM public.inventory_adjustment_items
    WHERE reason_code IS NOT NULL OR reason_reference IS NOT NULL),
  'old_item_signature',(SELECT md5(coalesce(string_agg(
    (to_jsonb(x)-'reason_code'-'reason_reference')::text,'|' ORDER BY x.id),''))
    FROM public.inventory_adjustment_items x),
  'new_function_present',to_regprocedure(
    'public.save_inventory_adjustment_draft_with_reasons(uuid,timestamptz,date,text,jsonb)') IS NOT NULL,
  'old_function_present',to_regprocedure(
    'public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)') IS NOT NULL,
  'security_definer',(SELECT prosecdef FROM pg_proc WHERE oid=
    'public.save_inventory_adjustment_draft_with_reasons(uuid,timestamptz,date,text,jsonb)'::regprocedure),
  'owner',(SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=
    'public.save_inventory_adjustment_draft_with_reasons(uuid,timestamptz,date,text,jsonb)'::regprocedure),
  'search_path',(SELECT array_to_string(proconfig,',') FROM pg_proc WHERE oid=
    'public.save_inventory_adjustment_draft_with_reasons(uuid,timestamptz,date,text,jsonb)'::regprocedure),
  'anon_execute',has_function_privilege('anon',
    'public.save_inventory_adjustment_draft_with_reasons(uuid,timestamptz,date,text,jsonb)','EXECUTE'),
  'authenticated_execute',has_function_privilege('authenticated',
    'public.save_inventory_adjustment_draft_with_reasons(uuid,timestamptz,date,text,jsonb)','EXECUTE'),
  'service_execute',has_function_privilege('service_role',
    'public.save_inventory_adjustment_draft_with_reasons(uuid,timestamptz,date,text,jsonb)','EXECUTE'),
  'post_trigger_enabled',EXISTS(SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.inventory_adjustments'::regclass
      AND tgname='require_inventory_adjustment_reason_on_post'
      AND tgenabled='O' AND NOT tgisinternal),
  'reason_code_check',EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='public.inventory_adjustment_items'::regclass
      AND conname='inventory_adjustment_reason_code_check'),
  'reference_check',EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='public.inventory_adjustment_items'::regclass
      AND conname='inventory_adjustment_reason_reference_check')
) AS adjustment_reasons_postapply;
ROLLBACK;
`;
const sqlPath=join(dir,'verification.sql');
writeFileSync(sqlPath,sql,{mode:0o600});
const result=spawnSync('npx',['-y','supabase@2.116.0','db','query','--linked',
  '--output-format','json','--file',sqlPath],{
  cwd:root,encoding:'utf8',timeout:300000,maxBuffer:64*1024*1024,
});
writeFileSync(join(dir,'run.log'),`${result.stdout??''}\n${result.stderr??''}\n${result.error?.message??''}\n`,{mode:0o600});
if(result.error || result.status!==0) throw new Error(`فشل تحقق أسباب التسوية: ${dir}/run.log`);
const output=result.stdout;
const payload=JSON.parse(output.slice(output.indexOf('{'),output.lastIndexOf('}')+1));
const state=payload.rows?.find((row)=>row.adjustment_reasons_postapply)?.adjustment_reasons_postapply;
if(!state || state.database!=='postgres' || !state.server_version?.startsWith('17.')
  || !state.migration_present || state.columns!==2 || state.reason_rows!==0
  || !state.new_function_present || !state.old_function_present
  || !state.security_definer || state.owner!=='postgres'
  || !state.search_path?.includes('search_path=public, pg_temp')
  || state.anon_execute || !state.authenticated_execute || !state.service_execute
  || !state.post_trigger_enabled || !state.reason_code_check || !state.reference_check) {
  throw new Error(`بنية الأسباب أو صلاحياتها غير آمنة: ${dir}/run.log`);
}
assert.equal(state.old_item_signature,expected.signatures.adjustment_items,
  'تغيرت بيانات البنود القديمة عند إضافة العمودين');
const after=stableBaseline(queryState(join(dir,'baseline-query.log')));
const before=stableBaseline(expected);
delete after.signatures.adjustment_items;
delete before.signatures.adjustment_items;
assert.deepEqual(after,before,'تغيرت بيانات الأعمال أو تشخيص Staging');
writeFileSync(join(dir,'report.json'),`${JSON.stringify({
  result:'STAGING_ADJUSTMENT_REASONS_POSTAPPLY_OK',verifiedAt:new Date().toISOString(),
  backup,definition:state,oldItemSignaturePreserved:true,businessBaselinePreserved:true,
},null,2)}\n`,{mode:0o600});
console.log('نجح التحقق الرسمي بعد تطبيق أسباب فرق التسوية على Staging');
console.log('الحقول والدالة والحارس والصلاحيات سليمة، وبيانات الأعمال والتشخيص مطابقة للنسخة');
console.log(`REPORT_DIR=${dir}`);
