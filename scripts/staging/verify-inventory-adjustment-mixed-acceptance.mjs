// Read-only acceptance check for Staging adjustment #35: one surplus and one shortage.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStagingLink, queryState, stableBaseline } from './backup-inventory-atomic-variance-baseline.mjs';

const [backup, mode] = process.argv.slice(2);
if (!backup?.startsWith('/backups/staging/inventory-adjustment-reason-post-before-')
    || !['--expect-draft', '--expect-posted'].includes(mode)) {
  throw new Error('حدد نسخة Staging الخاصة بالاختبار ومرحلة الفحص');
}
assertStagingLink();
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const manifest = JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8'));
for (const [name, metadata] of Object.entries(manifest.files ?? {})) {
  assert.equal(sha256(join(backup, name)), metadata.sha256, `بصمة النسخة غير صحيحة: ${name}`);
}
const expected = JSON.parse(readFileSync(join(backup, 'baseline.json'), 'utf8')).baseline;
assert.equal(expected.database, 'postgres');
assert.match(expected.server_version, /^17\./);
assert.equal(expected.diagnostic?.totals?.quantity_difference, 0);
assert.equal(expected.diagnostic?.totals?.movement_to_ledger_difference, 0.02);

process.umask(0o077);
const dir = mkdtempSync('/tmp/accounting-staging-mixed-adjustment-verification-');
chmodSync(dir, 0o700);
const sql = `BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'migration_present', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260925120000'
  ),
  'document', (
    SELECT jsonb_build_object('id',a.id,'number',a.adjustment_number,
      'date',a.adjustment_date,'status',a.status,
      'posted_number',a.posted_number,'journal_id',a.journal_entry_id)
    FROM public.inventory_adjustments a WHERE a.adjustment_number=35
  ),
  'items', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'code',p.code,'system_quantity',i.system_quantity,
      'actual_quantity',i.actual_quantity,'difference',i.difference,
      'unit_cost',i.unit_cost,'total_cost',i.total_cost,
      'reason',i.reason_code,'notes_present',NULLIF(btrim(i.notes),'') IS NOT NULL,
      'product_quantity',p.quantity_on_hand,
      'movement_quantity',(
        SELECT COALESCE(sum(public.inventory_signed_quantity(m.movement_type::text,m.quantity)),0)
        FROM public.inventory_movements m WHERE m.product_id=p.id
      ),
      'movement_book_value',(
        SELECT COALESCE(sum(CASE
          WHEN m.movement_type::text='adjustment' THEN sign(m.quantity)*abs(m.total_cost)
          WHEN m.movement_type::text IN ('sale','purchase_return') THEN -abs(m.total_cost)
          ELSE abs(m.total_cost) END),0)
        FROM public.inventory_movements m WHERE m.product_id=p.id
      )
    ) ORDER BY p.code),'[]'::jsonb)
    FROM public.inventory_adjustment_items i
    JOIN public.products p ON p.id=i.product_id
    JOIN public.inventory_adjustments a ON a.id=i.adjustment_id
    WHERE a.adjustment_number=35
  ),
  'effects', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'code',p.code,'type',m.movement_type,'quantity',m.quantity,'value',m.total_cost
    ) ORDER BY p.code),'[]'::jsonb)
    FROM public.inventory_movements m JOIN public.products p ON p.id=m.product_id
    WHERE m.reference_id=(SELECT id FROM public.inventory_adjustments WHERE adjustment_number=35)
  ),
  'operation_count', (
    SELECT count(*) FROM public.inventory_variance_operations o
    WHERE o.source_type='adjustment'
      AND o.source_id=(SELECT id FROM public.inventory_adjustments WHERE adjustment_number=35)
      AND o.operation_kind='post'
  ),
  'journal', (
    SELECT jsonb_build_object('status',j.status,'posted_number',j.posted_number)
    FROM public.journal_entries j
    WHERE j.id=(SELECT journal_entry_id FROM public.inventory_adjustments WHERE adjustment_number=35)
  ),
  'journal_lines', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'code',a.code,'debit',l.debit,'credit',l.credit
    ) ORDER BY a.code,l.debit,l.credit),'[]'::jsonb)
    FROM public.journal_entry_lines l JOIN public.accounts a ON a.id=l.account_id
    WHERE l.journal_entry_id=(SELECT journal_entry_id FROM public.inventory_adjustments WHERE adjustment_number=35)
  )
) AS mixed_adjustment;
ROLLBACK;
`;
const sqlPath = join(dir, 'verification.sql');
writeFileSync(sqlPath, sql, { mode: 0o600 });
const result = spawnSync('npx', ['-y', 'supabase@2.116.0', 'db', 'query', '--linked',
  '--output-format', 'json', '--file', sqlPath], {
  cwd: '/opt/accounting-app', encoding: 'utf8', timeout: 300000,
  maxBuffer: 64 * 1024 * 1024,
});
writeFileSync(join(dir, 'run.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.message ?? ''}\n`, { mode: 0o600 });
if (result.error || result.status !== 0) {
  throw new Error(`فشل فحص التسوية؛ التشخيص المحمي: ${dir}/run.log`);
}
const payload = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'), result.stdout.lastIndexOf('}') + 1));
const state = payload.rows?.find((row) => row.mixed_adjustment)?.mixed_adjustment;
assert.equal(state?.database, 'postgres');
assert.match(state.server_version, /^17\./);
assert.equal(state.migration_present, true);
assert.equal(state.document?.number, 35);
assert.equal(state.document?.date, '2026-09-27');
assert.deepEqual(state.items?.map((item) => [item.code, Number(item.system_quantity),
  Number(item.actual_quantity), Number(item.difference), item.notes_present]), [
  ['TST-2D-PI-001', 2, 3, 1, true],
  ['TST-2D-SI-001', 8, 7, -1, true],
]);

const current = stableBaseline(queryState(join(dir, 'baseline.log')));
if (mode === '--expect-draft') {
  assert.deepEqual(current, expected, 'تغير خط أساس Staging منذ النسخة');
  assert.equal(state.document.status, 'draft');
  assert.equal(state.document.posted_number, null);
  assert.equal(state.document.journal_id, null);
  assert.equal(Number(state.operation_count), 0);
  assert.deepEqual(state.effects, []);
  assert.deepEqual(state.journal_lines, []);
  assert.deepEqual(state.items.map((item) => [Number(item.product_quantity),
    Number(item.movement_quantity), Number(item.movement_book_value)]), [
    [2, 2, 100], [8, 8, 320],
  ]);
} else {
  assert.equal(state.document.status, 'posted');
  assert.ok(Number(state.document.posted_number) > 0);
  assert.ok(state.document.journal_id);
  assert.equal(state.journal?.status, 'posted');
  assert.ok(Number(state.journal?.posted_number) > 0);
  assert.equal(Number(state.operation_count), 1);
  assert.deepEqual(state.items.map((item) => [Number(item.product_quantity),
    Number(item.movement_quantity), Number(item.movement_book_value),
    Number(item.unit_cost), Number(item.total_cost)]), [
    [3, 3, 150, 50, 50], [7, 7, 280, 40, 40],
  ]);
  assert.deepEqual(state.effects.map((effect) => [effect.code,effect.type,
    Number(effect.quantity),Number(effect.value)]), [
    ['TST-2D-PI-001','adjustment',1,50],
    ['TST-2D-SI-001','adjustment',-1,40],
  ]);
  assert.deepEqual(state.journal_lines.map((line) => [line.code,
    Number(line.debit),Number(line.credit)]), [
    ['1104',0,40], ['1104',50,0], ['4201',0,50], ['5201',40,0],
  ]);
  assert.equal(current.counts.adjustments, expected.counts.adjustments);
  assert.equal(current.counts.adjustment_items, expected.counts.adjustment_items);
  assert.equal(current.counts.movements, expected.counts.movements + 2);
  assert.equal(current.counts.journals, expected.counts.journals + 1);
  assert.equal(current.counts.journal_lines, expected.counts.journal_lines + 4);
  assert.equal(current.diagnostic.totals.quantity_difference, 0);
  assert.equal(current.diagnostic.totals.card_quantity, expected.diagnostic.totals.card_quantity);
  assert.equal(current.diagnostic.totals.movement_quantity, expected.diagnostic.totals.movement_quantity);
  assert.equal(current.diagnostic.totals.movement_book_value,
    expected.diagnostic.totals.movement_book_value + 10);
  assert.equal(current.diagnostic.totals.ledger_1104_balance,
    expected.diagnostic.totals.ledger_1104_balance + 10);
  assert.equal(current.diagnostic.totals.movement_to_ledger_difference,
    expected.diagnostic.totals.movement_to_ledger_difference);
  assert.equal(current.diagnostic.totals.unlinked_journal_count, 0);
  assert.equal(current.diagnostic.totals.unlinked_movement_count, 0);
}

const report = {
  result: mode === '--expect-draft' ? 'STAGING_MIXED_ADJUSTMENT_DRAFT_OK'
    : 'STAGING_MIXED_ADJUSTMENT_POSTED_OK',
  backup, document: state.document, items: state.items,
  effects: state.effects, journal: state.journal, journalLines: state.journal_lines,
  baseline: current, verifiedAt: new Date().toISOString(),
};
writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report,null,2)}\n`, { mode: 0o600 });
console.log(mode === '--expect-draft'
  ? 'نجح فحص مسودة التسوية المختلطة على Staging للقراءة فقط'
  : 'نجح فحص ترحيل التسوية المختلطة على Staging للقراءة فقط');
console.log('REPAIR=ADJUSTMENT_35 ITEMS=2 SURPLUS=50 SHORTAGE=40');
console.log(`REPORT_DIR=${dir}`);
