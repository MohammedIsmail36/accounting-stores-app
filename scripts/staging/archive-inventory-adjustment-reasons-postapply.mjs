// Preserve the independent post-apply check and UI deploy proof.
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const [backup, reportDir, uiBackup, buildSource] = process.argv.slice(2);
if (!backup?.startsWith('/backups/staging/inventory-adjustment-reasons-before-')
  || !reportDir?.startsWith('/tmp/accounting-staging-adjustment-reasons-postapply-')
  || !uiBackup?.startsWith('/opt/backups/accounting-app/staging-inventory-draft-delete-ui-before-')
  || !buildSource?.startsWith('/tmp/accounting-staging-draft-delete-source-')) {
  throw new Error('حدد نسخة القاعدة وتقرير التحقق ونسخة الواجهة ومصدر البناء');
}
const destination=join(backup,'reason-postapply');
process.umask(0o077);
mkdirSync(destination,{mode:0o700});
mkdirSync(join(destination,'result'),{mode:0o700});
mkdirSync(join(destination,'source'),{mode:0o700});
const root='/opt/accounting-app';
const copies=[
  [join(reportDir,'report.json'),'result/report.json'],
  [join(reportDir,'verification.sql'),'result/verification.sql'],
  [join(reportDir,'run.log'),'result/run.log'],
  [join(uiBackup,'deploy-report.json'),'result/ui-deploy-report.json'],
  [join(uiBackup,'DEPLOY_GUARD.json'),'result/ui-deploy-guard.json'],
  [join(buildSource,'build-manifest.json'),'result/ui-build-manifest.json'],
  [join(root,'supabase/migrations/20260925120000_inventory_adjustment_reason_codes.sql'),'source/migration.sql'],
  [join(root,'supabase/rollback/20260925120000_inventory_adjustment_reason_codes.sql'),'source/rollback.sql'],
  [join(root,'scripts/staging/verify-inventory-adjustment-reasons-postapply.mjs'),'source/verifier.mjs'],
  [join(root,'scripts/staging/deploy-inventory-adjustment-reasons-ui.mjs'),'source/ui-deployer.mjs'],
];
const hash=(file)=>createHash('sha256').update(readFileSync(file)).digest('hex');
for(const [source,name] of copies){
  const target=join(destination,name);
  copyFileSync(source,target);
  chmodSync(target,0o600);
}
const files=copies.map(([,name])=>join(destination,name));
const manifest=join(destination,'manifest.json');
writeFileSync(manifest,`${JSON.stringify({
  result:'STAGING_ADJUSTMENT_REASONS_POSTAPPLY_ARCHIVED',
  createdAt:new Date().toISOString(), backup,
  files:Object.fromEntries(files.map((file)=>[
    relative(destination,file),{bytes:statSync(file).size,sha256:hash(file)},
  ])),
},null,2)}\n`,{mode:0o600});
writeFileSync(join(destination,'SHA256SUMS'),`${[...files,manifest]
  .map((file)=>`${hash(file)}  ${relative(destination,file)}`).join('\n')}\n`,{mode:0o600});
for(const file of [...files,manifest]){
  if(!readFileSync(join(destination,'SHA256SUMS'),'utf8').includes(`${hash(file)}  ${relative(destination,file)}`)){
    throw new Error('فشل فحص بصمة الدليل');
  }
}
console.log('حُفظ دليل تطبيق أسباب التسوية والتحقق والنشر مع بصماته');
console.log(`ARCHIVE_DIR=${destination}`);
