import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root='/opt/accounting-app';
const backup='/backups/staging/inventory-draft-save-before-JEpdCX';
const l3='/tmp/accounting-inventory-draft-save-l3-otcM5S';
const staging='/tmp/accounting-staging-inventory-draft-save-rehearsal-jdw4CK';
const archive=join(backup,'transactional-rehearsal');
if(existsSync(archive)) throw new Error('الأرشيف موجود؛ لن يُستبدل');
const l3Report=JSON.parse(readFileSync(join(l3,'report.json'),'utf8'));
const stagingReport=JSON.parse(readFileSync(join(staging,'report.json'),'utf8'));
if(l3Report.result!=='INVENTORY_ADJUSTMENT_ATOMIC_DRAFT_SAVE_L3_OK'
  || stagingReport.result!=='STAGING_DRAFT_SAVE_TRANSACTIONAL_REHEARSAL_OK') {
  throw new Error('تقارير الاختبار لا تطابق نتائج القبول');
}
process.umask(0o077);
mkdirSync(archive,{mode:0o700});
chmodSync(archive,0o700);
const sources=[
  [join(l3,'report.json'),'l3-report.json'],
  [join(staging,'report.json'),'staging-report.json'],
  [join(staging,'rehearsal.sql'),'staging-rehearsal.sql'],
  [join(staging,'run.log'),'staging-run.log'],
  [join(root,'supabase/migrations/20260925100000_inventory_adjustment_atomic_draft_save.sql'),'migration.sql'],
  [join(root,'supabase/rollback/20260925100000_inventory_adjustment_atomic_draft_save.sql'),'rollback.sql'],
  [join(root,'supabase/tests/inventory_adjustment_atomic_draft_save_contract.sql'),'l3-contract.sql'],
  [join(root,'supabase/tests/inventory_adjustment_atomic_draft_save_fixture.sql'),'l3-fixture.sql'],
  [join(root,'scripts/tests/rehearse-inventory-adjustment-atomic-draft-save.mjs'),'l3-runner.mjs'],
  [join(root,'scripts/staging/rehearse-inventory-adjustment-atomic-draft-save.mjs'),'staging-runner.mjs'],
  [join(root,'src/lib/inventory-adjustment-draft.ts'),'ui-bridge.ts'],
  [join(root,'src/pages/InventoryAdjustmentForm.tsx'),'ui-form.tsx'],
];
const sha=(file)=>createHash('sha256').update(readFileSync(file)).digest('hex');
for(const [source,name] of sources){
  const target=join(archive,name);
  copyFileSync(source,target);
  chmodSync(target,0o600);
  if(sha(source)!==sha(target)) throw new Error(`فشل تطابق ${name}`);
}
writeFileSync(join(archive,'SHA256SUMS'),`${sources.map(([,name])=>`${sha(join(archive,name))}  ${name}`).join('\n')}\n`,{mode:0o600});
console.log('تم حفظ دليل تجربة حفظ المسودة الذري والتحقق من بصماته');
console.log(`ARCHIVE_DIR=${archive}`);
