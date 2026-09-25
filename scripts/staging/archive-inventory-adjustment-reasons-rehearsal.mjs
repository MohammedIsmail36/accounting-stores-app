// Preserve exact tested inputs and outcomes beside the protected Staging backup.
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const [backup, stagingReport, l3Report] = process.argv.slice(2);
if (!backup?.startsWith('/backups/staging/inventory-adjustment-reasons-before-')
  || !stagingReport?.startsWith('/tmp/accounting-staging-adjustment-reasons-rehearsal-')
  || !l3Report?.startsWith('/tmp/accounting-inventory-reasons-l3-')) {
  throw new Error('حدد نسخة Staging وتقريري تجربة Staging وL3 المعزولين');
}
const root = '/opt/accounting-app';
const destination = join(backup,'reason-rehearsal');
process.umask(0o077);
mkdirSync(destination,{mode:0o700});
mkdirSync(join(destination,'result'),{mode:0o700});
mkdirSync(join(destination,'source'),{mode:0o700});
const copies = [
  [join(stagingReport,'report.json'),'result/staging-report.json'],
  [join(stagingReport,'rehearsal.sql'),'result/staging-rehearsal.sql'],
  [join(stagingReport,'run.log'),'result/staging-run.log'],
  [join(l3Report,'report.json'),'result/l3-report.json'],
  [join(root,'supabase/migrations/20260925120000_inventory_adjustment_reason_codes.sql'),'source/migration.sql'],
  [join(root,'supabase/rollback/20260925120000_inventory_adjustment_reason_codes.sql'),'source/rollback.sql'],
  [join(root,'supabase/tests/inventory_adjustment_reason_codes_contract.sql'),'source/contract.sql'],
  [join(root,'supabase/tests/inventory_adjustment_reason_codes_scenarios.sql'),'source/scenarios.sql'],
  [join(root,'scripts/tests/rehearse-inventory-adjustment-reasons-green.mjs'),'source/l3-runner.mjs'],
  [join(root,'scripts/staging/rehearse-inventory-adjustment-reasons.mjs'),'source/staging-runner.mjs'],
];
for (const [source,name] of copies) {
  const target = join(destination,name);
  copyFileSync(source,target);
  chmodSync(target,0o600);
}
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const files = copies.map(([,name])=>join(destination,name));
const manifest = join(destination,'manifest.json');
writeFileSync(manifest,`${JSON.stringify({
  result:'STAGING_ADJUSTMENT_REASONS_REHEARSAL_ARCHIVED',
  createdAt:new Date().toISOString(), backup,
  files:Object.fromEntries(files.map((file)=>[
    relative(destination,file),{bytes:statSync(file).size,sha256:hash(file)},
  ])),
},null,2)}\n`,{mode:0o600});
const sums = join(destination,'SHA256SUMS');
writeFileSync(sums,`${[...files,manifest]
  .map((file)=>`${hash(file)}  ${relative(destination,file)}`).join('\n')}\n`,{mode:0o600});
for (const line of readFileSync(sums,'utf8').trim().split('\n')) {
  const [expected,...parts] = line.split(/\s+/);
  if (hash(join(destination,parts.join(' '))) !== expected) throw new Error('فشل فحص بصمة الأرشيف');
}
if (readdirSync(join(destination,'result')).length !== 4) throw new Error('دليل التجربة ناقص');
console.log('حُفظ دليل أسباب فروق التسوية وتجربتي L3 وStaging مع التحقق من البصمات');
console.log(`ARCHIVE_DIR=${destination}`);
