import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStagingLink, queryState, stableBaseline } from './backup-inventory-atomic-variance-baseline.mjs';

const root='/opt/accounting-app';
const backup=process.argv[2];
assert.ok(backup?.startsWith('/backups/staging/inventory-draft-delete-before-'),
  'حدد مسار نسخة Staging الحديثة');
const expected=JSON.parse(readFileSync(join(backup,'baseline.json'),'utf8'));
assertStagingLink();
process.umask(0o077);
const dir=mkdtempSync('/tmp/accounting-staging-inventory-draft-delete-postapply-');
chmodSync(dir,0o700);
const sql=`BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
  'database',current_database(),
  'server_version',current_setting('server_version'),
  'migration_present',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20260925110000'),
  'function_present',to_regprocedure('public.delete_inventory_adjustment_draft(uuid,timestamptz)') IS NOT NULL,
  'security_definer',(SELECT prosecdef FROM pg_proc
    WHERE oid='public.delete_inventory_adjustment_draft(uuid,timestamptz)'::regprocedure),
  'owner',(SELECT pg_get_userbyid(proowner) FROM pg_proc
    WHERE oid='public.delete_inventory_adjustment_draft(uuid,timestamptz)'::regprocedure),
  'search_path',(SELECT array_to_string(proconfig,',') FROM pg_proc
    WHERE oid='public.delete_inventory_adjustment_draft(uuid,timestamptz)'::regprocedure),
  'anon_execute',has_function_privilege('anon',
    'public.delete_inventory_adjustment_draft(uuid,timestamptz)','EXECUTE'),
  'authenticated_execute',has_function_privilege('authenticated',
    'public.delete_inventory_adjustment_draft(uuid,timestamptz)','EXECUTE'),
  'service_execute',has_function_privilege('service_role',
    'public.delete_inventory_adjustment_draft(uuid,timestamptz)','EXECUTE'),
  'anon_header_delete',has_table_privilege('anon','public.inventory_adjustments','DELETE'),
  'anon_items_delete',has_table_privilege('anon','public.inventory_adjustment_items','DELETE'),
  'authenticated_header_delete',has_table_privilege('authenticated','public.inventory_adjustments','DELETE'),
  'authenticated_items_delete',has_table_privilege('authenticated','public.inventory_adjustment_items','DELETE'),
  'draft_21',(SELECT jsonb_build_object('status',status,'posted_number',posted_number,
    'item_count',(SELECT count(*) FROM public.inventory_adjustment_items
      WHERE adjustment_id=a.id)) FROM public.inventory_adjustments a
      WHERE a.adjustment_number=21 LIMIT 1)
) AS draft_delete_postapply;
ROLLBACK;
`;
const sqlPath=join(dir,'verification.sql');
writeFileSync(sqlPath,sql,{mode:0o600});
const result=spawnSync('npx',['-y','supabase@2.116.0','db','query','--linked',
  '--output-format','json','--file',sqlPath],{
    cwd:root,encoding:'utf8',timeout:300000,maxBuffer:64*1024*1024,
  });
writeFileSync(join(dir,'run.log'),`${result.stdout??''}\n${result.stderr??''}\n${result.error?.message??''}\n`,{mode:0o600});
if(result.error || result.status!==0) throw new Error(`فشل تحقق التطبيق: ${dir}/run.log`);
const payload=JSON.parse(result.stdout.slice(result.stdout.indexOf('{'),result.stdout.lastIndexOf('}')+1));
const state=payload.rows?.find((row)=>row.draft_delete_postapply)?.draft_delete_postapply;
if(!state?.server_version?.startsWith('17.') || state.database!=='postgres'
  || !state.migration_present || !state.function_present || !state.security_definer
  || state.owner!=='postgres' || !state.search_path.includes('search_path=public, pg_temp')
  || state.anon_execute || !state.authenticated_execute || state.service_execute
  || state.anon_header_delete || state.anon_items_delete
  || state.authenticated_header_delete || state.authenticated_items_delete
  || state.draft_21?.status!=='draft' || state.draft_21?.posted_number!==null
  || state.draft_21?.item_count!==2) {
  throw new Error(`تعريف دالة الحذف أو الصلاحيات أو المسودة #21 غير آمنة: ${dir}/run.log`);
}
const after=queryState(join(dir,'baseline-query.log'));
assert.equal(JSON.stringify(stableBaseline(after)),JSON.stringify(stableBaseline(expected)),
  'تغيرت بيانات الأعمال أو تشخيص Staging بعد التطبيق');
writeFileSync(join(dir,'report.json'),`${JSON.stringify({
  result:'STAGING_INVENTORY_DRAFT_DELETE_POSTAPPLY_OK',verifiedAt:new Date().toISOString(),
  backup,definition:state,businessBaselinePreserved:true,
},null,2)}\n`,{mode:0o600});
console.log('نجح التحقق بعد تطبيق حذف المسودة الذري على Staging؛ المسودة #21 وبيانات الأعمال لم تتغير');
console.log(`REPORT_DIR=${dir}`);
