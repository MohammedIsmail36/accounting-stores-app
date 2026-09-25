import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const archive='/backups/staging/inventory-draft-delete-before-vJ7G87/atomic-delete-verification';
const files=[
  ['/tmp/accounting-inventory-draft-delete-l3-7DloY3/report.json','l3/report.json'],
  ['/tmp/accounting-inventory-draft-delete-l3-7DloY3/run.log','l3/run.log'],
  ['/tmp/accounting-staging-inventory-draft-delete-rehearsal-etu5tR/report.json','rehearsal/report.json'],
  ['/tmp/accounting-staging-inventory-draft-delete-rehearsal-etu5tR/rehearsal.sql','rehearsal/rehearsal.sql'],
  ['/tmp/accounting-staging-inventory-draft-delete-rehearsal-etu5tR/run.log','rehearsal/run.log'],
  ['/tmp/accounting-staging-inventory-draft-delete-postapply-ZTyA1U/report.json','postapply/report.json'],
  ['/tmp/accounting-staging-inventory-draft-delete-postapply-ZTyA1U/verification.sql','postapply/verification.sql'],
  ['/tmp/accounting-staging-inventory-draft-delete-postapply-ZTyA1U/run.log','postapply/run.log'],
  ['/tmp/accounting-staging-draft-delete-source-BAxaWa/build-manifest.json','ui/build-manifest.json'],
  ['/opt/backups/accounting-app/staging-inventory-draft-delete-ui-before-9X9CyO/DEPLOY_GUARD.json','ui/DEPLOY_GUARD.json'],
  ['/opt/backups/accounting-app/staging-inventory-draft-delete-ui-before-9X9CyO/deploy-report.json','ui/deploy-report.json'],
  ['/opt/accounting-app/supabase/migrations/20260925110000_inventory_adjustment_atomic_draft_delete.sql','source/migration.sql'],
  ['/opt/accounting-app/supabase/rollback/20260925110000_inventory_adjustment_atomic_draft_delete.sql','source/rollback.sql'],
  ['/opt/accounting-app/supabase/tests/inventory_adjustment_atomic_draft_delete_contract.sql','source/contract.sql'],
  ['/opt/accounting-app/scripts/tests/rehearse-inventory-adjustment-atomic-draft-delete.mjs','source/l3-runner.mjs'],
];
process.umask(0o077);
mkdirSync(archive,{mode:0o700});
const hashes=[];
for(const [source,target] of files) {
  if(statSync(source).size===0) throw new Error(`ملف الدليل فارغ: ${source}`);
  const directory=target.split('/')[0];
  try { mkdirSync(join(archive,directory),{mode:0o700}); } catch(error) {
    if(error.code!=='EEXIST') throw error;
  }
  const destination=join(archive,target);
  copyFileSync(source,destination);
  const expected=createHash('sha256').update(readFileSync(source)).digest('hex');
  const actual=createHash('sha256').update(readFileSync(destination)).digest('hex');
  if(actual!==expected) throw new Error(`فشل تطابق ${target}`);
  hashes.push(`${actual}  ${target}`);
}
writeFileSync(join(archive,'SHA256SUMS'),`${hashes.join('\n')}\n`,{mode:0o600});
console.log('حُفظ دليل حذف المسودة الذري وتجربته ونشره على Staging وتحققت بصماته');
console.log(`ARCHIVE_DIR=${archive}`);
