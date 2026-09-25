import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root='/opt/accounting-app';
const source='/tmp/accounting-staging-draft-save-source-Kaqs1q';
const uiBackup='/opt/backups/accounting-app/staging-inventory-draft-save-ui-before-cKmrOs';
const destination='/backups/staging/inventory-draft-save-before-JEpdCX/ui-deploy-proof';
const manifest=JSON.parse(readFileSync(join(source,'build-manifest.json'),'utf8'));
const report=JSON.parse(readFileSync(join(uiBackup,'deploy-report.json'),'utf8'));
if(existsSync(destination) || report.result!=='STAGING_DRAFT_SAVE_UI_DEPLOYED'
  || manifest.result!=='STAGING_DRAFT_SAVE_UI_BUILD_READY'
  || report.indexSha256!==manifest.indexSha256
  || report.buildCommit!==manifest.commit) throw new Error('دليل النشر غير متسق أو الأرشيف موجود');
const sha=(file)=>createHash('sha256').update(readFileSync(file)).digest('hex');
if(sha('/var/www/staging.alibea2020.com/index.html')!==report.indexSha256) {
  throw new Error('واجهة Staging الحية لا تطابق البناء');
}
process.umask(0o077);
mkdirSync(destination,{mode:0o700});
chmodSync(destination,0o700);
const files=[
  [join(source,'build-manifest.json'),'build-manifest.json'],
  [join(uiBackup,'DEPLOY_GUARD.json'),'predeploy-guard.json'],
  [join(uiBackup,'deploy-report.json'),'deploy-report.json'],
  [join(root,'scripts/staging/prepare-inventory-adjustment-draft-save-ui.mjs'),'build-runner.mjs'],
  [join(root,'scripts/staging/backup-inventory-adjustment-draft-save-ui.mjs'),'backup-runner.mjs'],
  [join(root,'scripts/staging/deploy-inventory-adjustment-draft-save-ui.mjs'),'deploy-runner.mjs'],
];
for(const [from,name] of files){
  const target=join(destination,name);
  copyFileSync(from,target);
  chmodSync(target,0o600);
  if(sha(from)!==sha(target)) throw new Error(`فشل حفظ ${name}`);
}
writeFileSync(join(destination,'SHA256SUMS'),`${files
  .map(([,name])=>`${sha(join(destination,name))}  ${name}`).join('\n')}\n`,{mode:0o600});
console.log('حُفظ دليل بناء ونشر واجهة Staging والتحقق من بصماته');
console.log(`ARCHIVE_DIR=${destination}`);
