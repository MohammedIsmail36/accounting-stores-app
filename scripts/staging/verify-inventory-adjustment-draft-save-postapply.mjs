import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStagingLink, queryState, stableBaseline } from './backup-inventory-atomic-variance-baseline.mjs';

const root='/opt/accounting-app';
const backup='/backups/staging/inventory-draft-save-before-JEpdCX';
const expected=JSON.parse(readFileSync(join(backup,'baseline.json'),'utf8'));
assertStagingLink();
process.umask(0o077);
const dir=mkdtempSync('/tmp/accounting-staging-inventory-draft-save-postapply-');
chmodSync(dir,0o700);
const sql=`BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
  'database',current_database(),
  'server_version',current_setting('server_version'),
  'migration_present',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20260925100000'),
  'function_present',to_regprocedure('public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)') IS NOT NULL,
  'security_definer',(SELECT prosecdef FROM pg_proc
    WHERE oid='public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)'::regprocedure),
  'owner',(SELECT pg_get_userbyid(proowner) FROM pg_proc
    WHERE oid='public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)'::regprocedure),
  'search_path',(SELECT array_to_string(proconfig,',') FROM pg_proc
    WHERE oid='public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)'::regprocedure),
  'anon_execute',has_function_privilege('anon',
    'public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)','EXECUTE'),
  'authenticated_execute',has_function_privilege('authenticated',
    'public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)','EXECUTE'),
  'service_execute',has_function_privilege('service_role',
    'public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)','EXECUTE'),
  'post_function_present',to_regprocedure('public.post_inventory_adjustment_atomic(uuid,uuid)') IS NOT NULL,
  'reverse_function_present',to_regprocedure('public.reverse_inventory_adjustment_atomic(uuid,uuid,text)') IS NOT NULL
) AS draft_save_postapply;
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
const state=payload.rows?.find((row)=>row.draft_save_postapply)?.draft_save_postapply;
if(!state?.server_version?.startsWith('17.') || state.database!=='postgres'
  || !state.migration_present || !state.function_present || !state.security_definer
  || state.owner!=='postgres' || !state.search_path.includes('search_path=public, pg_temp')
  || state.anon_execute || !state.authenticated_execute || !state.service_execute
  || !state.post_function_present || !state.reverse_function_present) {
  throw new Error(`تعريف الدالة أو الصلاحيات غير آمنة: ${dir}/run.log`);
}
const after=queryState(join(dir,'baseline-query.log'));
assert.equal(JSON.stringify(stableBaseline(after)),JSON.stringify(stableBaseline(expected)),
  'تغيرت بيانات الأعمال أو تشخيص Staging بعد التطبيق');
writeFileSync(join(dir,'report.json'),`${JSON.stringify({
  result:'STAGING_INVENTORY_DRAFT_SAVE_POSTAPPLY_OK',verifiedAt:new Date().toISOString(),
  backup,definition:state,businessBaselinePreserved:true,
},null,2)}\n`,{mode:0o600});
console.log('نجح التحقق بعد تطبيق مدخل حفظ المسودة على Staging؛ البيانات والتشخيص لم يتغيرا');
console.log(`REPORT_DIR=${dir}`);
