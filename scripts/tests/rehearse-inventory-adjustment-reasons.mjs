// Phase 4C red gate. Read-only; accepts only the frozen, network-isolated L3 clone.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertIsolation, container, database } from './rehearse-public-restore.mjs';

const mode = process.argv[2];
if (!['--expect-missing', '--verify-contract'].includes(mode)) {
  throw new Error('استخدم --expect-missing أو --verify-contract');
}

function docker(args, input) {
  const result = spawnSync('docker', args, {
    input, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || 'فشل استعلام L3');
  }
  return result.stdout?.trim() ?? '';
}

const inspected = JSON.parse(docker(['inspect', container]));
assertIsolation(inspected[0]);
const state = docker([
  'exec', '-i', container, 'psql', '-h', '/tmp', '-U', 'postgres', '-d', database,
  '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-',
], `BEGIN READ ONLY;
SELECT jsonb_build_object(
  'database', current_database(), 'role', current_user,
  'reason_code', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inventory_adjustment_items'
      AND column_name='reason_code'
  ),
  'reason_reference', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inventory_adjustment_items'
      AND column_name='reason_reference'
  ),
  'save_function', to_regprocedure(
    'public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)'
  ) IS NOT NULL
);
ROLLBACK;`);
const match = state.match(/\{[^\n]+\}/);
if (!match) throw new Error('لم تُقرأ حالة قاعدة L3');
const result = JSON.parse(match[0]);
assert.equal(result.database, database);
assert.equal(result.role, 'postgres');

if (mode === '--expect-missing') {
  assert.equal(result.reason_code, false, 'العقد لم يعد في الحالة الحمراء');
  assert.equal(result.reason_reference, false, 'العقد لم يعد في الحالة الحمراء');
  assert.equal(result.save_function, false, 'قاعدة L3 لم تُعَد إلى خطها الأساسي');
  console.log('TDD_ADJUSTMENT_REASON_RED_OK: حقلا السبب والمرجع غير موجودين كما هو متوقع');
  console.log('الاختبار للقراءة فقط؛ لم تتغير L3 أو Staging أو الإنتاج');
} else {
  assert.equal(result.reason_code, true);
  assert.equal(result.reason_reference, true);
  assert.equal(result.save_function, true);
  const contract = readFileSync(fileURLToPath(
    new URL('../../supabase/tests/inventory_adjustment_reason_codes_contract.sql', import.meta.url),
  ), 'utf8');
  const output = docker([
    'exec', '-i', container, 'psql', '-h', '/tmp', '-U', 'postgres', '-d', database,
    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-',
  ], `BEGIN READ ONLY;\n${contract}\nROLLBACK;`);
  assert.match(output, /INVENTORY_ADJUSTMENT_REASON_CONTRACT_OK/);
  console.log('نجح تحقق بنية أسباب التسوية وحارسي الحفظ والترحيل داخل L3 للقراءة فقط');
}
