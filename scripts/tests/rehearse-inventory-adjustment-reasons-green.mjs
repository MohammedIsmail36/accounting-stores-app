// Phase 4C migration, scenario and explicit-rollback rehearsal in frozen L3 only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertIsolation, container, database } from './rehearse-public-restore.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const files = [
  'supabase/tests/inventory_adjustment_atomic_draft_save_fixture.sql',
  'supabase/migrations/20260925100000_inventory_adjustment_atomic_draft_save.sql',
  'supabase/migrations/20260925120000_inventory_adjustment_reason_codes.sql',
  'supabase/tests/inventory_adjustment_reason_codes_contract.sql',
  'supabase/tests/inventory_adjustment_reason_codes_scenarios.sql',
  'supabase/rollback/20260925120000_inventory_adjustment_reason_codes.sql',
];
const signature = `SELECT jsonb_build_object(
  'adjustments',(SELECT md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY x.id),'')) FROM public.inventory_adjustments x),
  'items',(SELECT md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY x.id),'')) FROM public.inventory_adjustment_items x),
  'products',(SELECT md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY x.id),'')) FROM public.products x),
  'movements',(SELECT md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY x.id),'')) FROM public.inventory_movements x),
  'journals',(SELECT md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY x.id),'')) FROM public.journal_entries x)
);`;

function docker(args, input) {
  const result = spawnSync('docker', args, {
    input, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || 'فشل استعلام L3');
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}
function query(sql) {
  return docker([
    'exec', '-i', container, 'psql', '-h', '/tmp', '-U', 'postgres', '-d', database,
    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-',
  ], sql).trim();
}

const inspected = JSON.parse(docker(['inspect', container]));
assertIsolation(inspected[0]);
const before = query(signature);
assert.equal(query("SELECT to_regprocedure('public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)') IS NULL"), 't');
assert.equal(query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_adjustment_items' AND column_name='reason_code')"), 'f');

const sql = [
  'BEGIN;',
  "SET LOCAL lock_timeout='5s';",
  "SET LOCAL statement_timeout='90s';",
  `DO $isolation$ BEGIN IF current_database() <> '${database}' OR current_user <> 'postgres' THEN RAISE EXCEPTION 'ADJUSTMENT_REASON_ISOLATION_FAILED'; END IF; END $isolation$;`,
  ...files.map((file) => readFileSync(join(root, file), 'utf8')),
  `DO $verify$ BEGIN
    IF to_regprocedure('public.save_inventory_adjustment_draft_with_reasons(uuid,timestamptz,date,text,jsonb)') IS NOT NULL
      OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='inventory_adjustment_items' AND column_name='reason_code')
    THEN RAISE EXCEPTION 'ADJUSTMENT_REASON_ROLLBACK_FAILED'; END IF;
  END $verify$;`,
  'ROLLBACK;',
].join('\n');
const dir = mkdtempSync('/tmp/accounting-inventory-reasons-l3-');
chmodSync(dir, 0o700);
try {
  const output = query(sql);
  writeFileSync(join(dir, 'run.log'), `${output}\n`, { mode: 0o600 });
  assert.match(output, /INVENTORY_ADJUSTMENT_REASON_CONTRACT_OK/);
  assert.match(output, /INVENTORY_ADJUSTMENT_REASON_SCENARIOS_OK/);
  assert.equal(query(signature), before, 'تغيرت بيانات L3 بعد ROLLBACK');
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify({
    result: 'INVENTORY_ADJUSTMENT_REASONS_L3_OK', isolated: true,
    rolledBack: true, baselinePreserved: true,
    scenarios: ['create','edit','missing-reason','invalid-code','missing-reference',
      'missing-note','stale-version','duplicate-product','injected-insert-failure',
      'direct-invalid-code','unauthorized','legacy-draft-post-rejection',
      'valid-post','zero-difference','explicit-rollback'],
  }, null, 2)}\n`, { mode: 0o600 });
  console.log('نجحت Migration أسباب الفروق وسيناريوهاتها والرجوع داخل L3 المعزولة');
  console.log(`REPORT_DIR=${dir}`);
} catch (error) {
  if (query(signature) !== before) console.error('تحذير: تغير خط أساس L3');
  console.error(`فشل اختبار أسباب الفروق؛ التشخيص المحمي: ${dir}`);
  throw error;
}
