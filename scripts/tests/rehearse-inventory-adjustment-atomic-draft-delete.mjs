// Phase 4B database contract. Runs only against the frozen network-isolated L3 clone.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertIsolation, container, database } from './rehearse-public-restore.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const path = (relative) => join(root, relative);
const fixture = path('supabase/tests/inventory_adjustment_atomic_draft_save_fixture.sql');
const saveMigration = path('supabase/migrations/20260925100000_inventory_adjustment_atomic_draft_save.sql');
const deleteFixture = path('supabase/tests/inventory_adjustment_atomic_draft_delete_fixture.sql');
const migration = path('supabase/migrations/20260925110000_inventory_adjustment_atomic_draft_delete.sql');
const contract = path('supabase/tests/inventory_adjustment_atomic_draft_delete_contract.sql');
const rollback = path('supabase/rollback/20260925110000_inventory_adjustment_atomic_draft_delete.sql');
const signature = `SELECT jsonb_build_object(
  'adjustments',(SELECT md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY x.id),'')) FROM public.inventory_adjustments x),
  'items',(SELECT md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY x.id),'')) FROM public.inventory_adjustment_items x),
  'products',(SELECT md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY x.id),'')) FROM public.products x),
  'movements',(SELECT md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY x.id),'')) FROM public.inventory_movements x),
  'journals',(SELECT md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY x.id),'')) FROM public.journal_entries x)
);`;
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding:'utf8', timeout:120000,
    maxBuffer:16*1024*1024 });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || 'فشل استعلام L3');
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}
function query(sql) {
  return docker(['exec','-i',container,'psql','-h','/tmp','-U','postgres','-d',database,
    '-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-f','-'],sql).trim();
}
const inspected = JSON.parse(docker(['inspect',container]));
assertIsolation(inspected[0]);
const before = query(signature);
assert.equal(query("SELECT to_regprocedure('public.delete_inventory_adjustment_draft(uuid,timestamptz)') IS NULL"),'t');
const sql = [
  'BEGIN;', "SET LOCAL lock_timeout='5s';", "SET LOCAL statement_timeout='90s';",
  `DO $isolation$ BEGIN IF current_database() <> '${database}' OR current_user <> 'postgres' THEN RAISE EXCEPTION 'DRAFT_DELETE_ISOLATION_FAILED'; END IF; END $isolation$;`,
  readFileSync(fixture,'utf8'),readFileSync(saveMigration,'utf8'),
  readFileSync(deleteFixture,'utf8'),readFileSync(migration,'utf8'),
  readFileSync(contract,'utf8'),readFileSync(rollback,'utf8'),
  `DO $verify$ BEGIN IF to_regprocedure('public.delete_inventory_adjustment_draft(uuid,timestamptz)') IS NOT NULL
    OR NOT has_table_privilege('authenticated','public.inventory_adjustments','DELETE')
    OR NOT has_table_privilege('authenticated','public.inventory_adjustment_items','DELETE')
    THEN RAISE EXCEPTION 'DRAFT_DELETE_ROLLBACK_FAILED'; END IF; END $verify$;`,
  'ROLLBACK;',
].join('\n');
const dir = mkdtempSync('/tmp/accounting-inventory-draft-delete-l3-');
chmodSync(dir,0o700);
try {
  const output=query(sql);
  writeFileSync(join(dir,'run.log'),`${output}\n`,{mode:0o600});
  assert.match(output,/INVENTORY_DRAFT_DELETE_CONTRACT_OK/);
  assert.equal(query(signature),before,'تغيرت بيانات L3 بعد ROLLBACK');
  writeFileSync(join(dir,'report.json'),`${JSON.stringify({
    result:'INVENTORY_ADJUSTMENT_ATOMIC_DRAFT_DELETE_L3_OK',
    isolated:true,rolledBack:true,businessBaselinePreserved:true,
    scenarios:['admin-delete','child-cascade','stale-version','non-admin','posted-document',
      'existing-operation','injected-child-failure','repeat-delete','direct-delete-revoked','explicit-rollback'],
  },null,2)}\n`,{mode:0o600});
  console.log('نجح عقد حذف المسودة الذري في L3 المعزولة، مع منع الحذف المباشر واختبار فشل التابع');
  console.log(`REPORT_DIR=${dir}`);
} catch (error) {
  const after=query(signature);
  if (after!==before) console.error('تحذير: تغير خط أساس L3؛ يجب فحص القاعدة قبل أي تجربة جديدة');
  console.error(`فشل اختبار L3؛ التشخيص: ${dir}`);
  throw error;
}
