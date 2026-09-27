// Snapshot the current Staging public data before a reason-coded posting test.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStagingLink, queryState, stableBaseline } from './backup-inventory-atomic-variance-baseline.mjs';

const root = '/opt/accounting-app';
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
function cli(args, log) {
  const result = spawnSync('npx', ['-y', 'supabase@2.116.0', ...args], {
    cwd: root, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    writeFileSync(log, `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.message ?? ''}\n`, { mode: 0o600 });
    throw new Error(`فشل نسخ Staging؛ التشخيص المحمي: ${log}`);
  }
  return result.stdout ?? '';
}

assertStagingLink();
process.umask(0o077);
const dir = mkdtempSync('/backups/staging/inventory-adjustment-reason-post-before-');
chmodSync(dir, 0o700);
const log = join(dir, 'run.log');
const before = stableBaseline(queryState(log));
if (before.database !== 'postgres' || !before.server_version?.startsWith('17.')
    || !before.engine_exists || before.diagnostic?.totals?.quantity_difference !== 0
    || before.diagnostic?.totals?.movement_to_ledger_difference !== 0.02) {
  throw new Error(`خط أساس Staging غير آمن؛ لم تُعتمد النسخة: ${dir}`);
}
const verification = cli(['db', 'query', '--linked', '--output-format', 'json',
  "BEGIN TRANSACTION READ ONLY; SELECT jsonb_build_object('migration',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260925120000'),'draft34',(SELECT jsonb_build_object('status',a.status,'items',(SELECT count(*) FROM public.inventory_adjustment_items i WHERE i.adjustment_id=a.id),'coded',(SELECT count(*) FROM public.inventory_adjustment_items i WHERE i.adjustment_id=a.id AND i.reason_code IS NOT NULL)) FROM public.inventory_adjustments a WHERE a.adjustment_number=34),'candidate',(SELECT jsonb_build_object('quantity',p.quantity_on_hand,'book',COALESCE(sum(CASE WHEN m.movement_type::text='adjustment' THEN sign(m.quantity)*abs(m.total_cost) WHEN m.movement_type::text IN ('sale','purchase_return') THEN -abs(m.total_cost) ELSE abs(m.total_cost) END),0),'movement_quantity',COALESCE(sum(public.inventory_signed_quantity(m.movement_type::text,m.quantity)),0)) FROM public.products p LEFT JOIN public.inventory_movements m ON m.product_id=p.id WHERE p.code='TST-2D-SI-001' AND p.is_active GROUP BY p.id,p.quantity_on_hand)) AS preflight; ROLLBACK;"], log);
const payload = JSON.parse(verification.slice(verification.indexOf('{'), verification.lastIndexOf('}') + 1));
const check = payload.rows?.find((row) => row.preflight)?.preflight;
if (!check?.migration || check.draft34?.status !== 'draft'
    || Number(check.draft34?.items) !== 1 || Number(check.draft34?.coded) !== 1
    || Number(check.candidate?.quantity) !== 8
    || Number(check.candidate?.movement_quantity) !== 8
    || Number(check.candidate?.book) !== 320) {
  throw new Error(`تغيرت المسودة #34 أو حالة الاختبار؛ لم تُعتمد النسخة: ${dir}`);
}

const schema = join(dir, 'public-schema.sql');
const data = join(dir, 'public-data.sql');
cli(['db', 'dump', '--linked', '--schema', 'public', '--file', schema], log);
cli(['db', 'dump', '--linked', '--schema', 'public', '--data-only', '--use-copy', '--file', data], log);
chmodSync(schema, 0o600);
chmodSync(data, 0o600);
if (statSync(schema).size < 10000 || statSync(data).size < 10000) {
  throw new Error(`ملفات نسخة Staging غير مكتملة: ${dir}`);
}
const after = stableBaseline(queryState(log));
if (JSON.stringify(before) !== JSON.stringify(after)) {
  throw new Error(`تغيرت Staging أثناء النسخ؛ لم تُعتمد النسخة: ${dir}`);
}
const baseline = join(dir, 'baseline.json');
writeFileSync(baseline, `${JSON.stringify({ baseline: after, preflight: check }, null, 2)}\n`, { mode: 0o600 });
const manifest = join(dir, 'manifest.json');
writeFileSync(manifest, `${JSON.stringify({
  result: 'STAGING_ADJUSTMENT_REASON_POST_BACKUP_OK',
  createdAt: new Date().toISOString(), scope: 'Staging public schema and data',
  files: Object.fromEntries([schema, data, baseline].map((file) => [
    file.split('/').at(-1), { bytes: statSync(file).size, sha256: sha(file) },
  ])),
}, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(dir, 'SHA256SUMS'), `${[schema, data, baseline, manifest]
  .map((file) => `${sha(file)}  ${file.split('/').at(-1)}`).join('\n')}\n`, { mode: 0o600 });
console.log('تم حفظ نسخة Staging قبل اختبار ترحيل السبب والتحقق من ثبات البيانات');
console.log(`BACKUP_DIR=${dir}`);
