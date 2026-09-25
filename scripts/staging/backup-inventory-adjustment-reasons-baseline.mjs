// Read-only public-schema/data snapshot before Phase 4C on Staging.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStagingLink, queryState, stableBaseline } from './backup-inventory-atomic-variance-baseline.mjs';

const root = '/opt/accounting-app';
function cli(args) {
  const result = spawnSync('npx', ['-y','supabase@2.116.0', ...args], {
    cwd: root, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || 'فشل نسخ Staging');
  }
}
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
function phase4Versions() {
  const result = spawnSync('npx', ['-y','supabase@2.116.0','db','query','--linked',
    '--output-format','json',
    "select version from supabase_migrations.schema_migrations where version in ('20260925100000','20260925110000','20260925120000') order by version"], {
    cwd:root, encoding:'utf8', timeout:300000, maxBuffer:8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error('تعذر قراءة سجل ترحيلات Staging');
  const output = result.stdout ?? '';
  const parsed = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
  return parsed.rows.map((row) => row.version);
}

assertStagingLink();
process.umask(0o077);
const dir = mkdtempSync('/backups/staging/inventory-adjustment-reasons-before-');
chmodSync(dir, 0o700);
const before = queryState(join(dir, 'run.log'));
const beforeVersions = phase4Versions();
if (before.database !== 'postgres' || !before.server_version.startsWith('17.')
  || !before.engine_exists || before.diagnostic.status !== 'rounding_only'
  || before.diagnostic.totals.movement_to_ledger_difference !== 0.02
  || JSON.stringify(beforeVersions) !== JSON.stringify(['20260925100000','20260925110000'])) {
  throw new Error(`خط أساس أسباب التسوية غير آمن؛ الأرشيف غير معتمد: ${dir}`);
}
const schema = join(dir, 'public-schema.sql');
const data = join(dir, 'public-data.sql');
cli(['db','dump','--linked','--schema','public','--file',schema]);
cli(['db','dump','--linked','--schema','public','--data-only','--use-copy','--file',data]);
chmodSync(schema,0o600); chmodSync(data,0o600);
if (statSync(schema).size < 10000 || statSync(data).size < 10000) {
  throw new Error(`نسخة public غير مكتملة: ${dir}`);
}
const after = queryState(join(dir, 'run.log'));
const afterVersions = phase4Versions();
if (JSON.stringify(stableBaseline(before)) !== JSON.stringify(stableBaseline(after))
  || JSON.stringify(beforeVersions) !== JSON.stringify(afterVersions)) {
  throw new Error(`تغيرت Staging أثناء النسخ؛ الأرشيف غير معتمد: ${dir}`);
}
const baseline = join(dir, 'baseline.json');
writeFileSync(baseline, `${JSON.stringify(after,null,2)}\n`, { mode: 0o600 });
const manifest = join(dir, 'manifest.json');
writeFileSync(manifest, `${JSON.stringify({
  result:'STAGING_INVENTORY_ADJUSTMENT_REASONS_BASELINE_OK',
  createdAt:new Date().toISOString(), scope:'Staging public schema and data',
  phase4Versions:afterVersions,
  files:Object.fromEntries([schema,data,baseline].map((file) => [
    file.split('/').at(-1), { bytes:statSync(file).size, sha256:sha(file) },
  ])),
},null,2)}\n`, { mode: 0o600 });
writeFileSync(join(dir,'SHA256SUMS'), `${[schema,data,baseline,manifest]
  .map((file) => `${sha(file)}  ${file.split('/').at(-1)}`).join('\n')}\n`, { mode: 0o600 });
console.log('تم حفظ نسخة Staging وخط أساس أسباب الفروق دون كتابة على القاعدة');
console.log(`BACKUP_DIR=${dir}`);
