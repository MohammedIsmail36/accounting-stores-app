import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root='/opt/accounting-app';
const source='/tmp/accounting-staging-inventory-draft-save-postapply-qkTkRs';
const archive='/backups/staging/inventory-draft-save-before-JEpdCX/post-apply-verification';
if(existsSync(archive)) throw new Error('دليل التطبيق موجود بالفعل؛ لن يُستبدل');
const report=JSON.parse(readFileSync(join(source,'report.json'),'utf8'));
if(report.result!=='STAGING_INVENTORY_DRAFT_SAVE_POSTAPPLY_OK'
  || !report.businessBaselinePreserved) throw new Error('تقرير التحقق غير مقبول');
process.umask(0o077);
mkdirSync(archive,{mode:0o700});
chmodSync(archive,0o700);
const files=[
  [join(source,'report.json'),'report.json'],
  [join(source,'verification.sql'),'verification.sql'],
  [join(source,'run.log'),'run.log'],
  [join(root,'supabase/migrations/20260925100000_inventory_adjustment_atomic_draft_save.sql'),'migration.sql'],
  [join(root,'supabase/rollback/20260925100000_inventory_adjustment_atomic_draft_save.sql'),'rollback.sql'],
  [join(root,'scripts/staging/verify-inventory-adjustment-draft-save-postapply.mjs'),'verification-runner.mjs'],
];
const sha=(file)=>createHash('sha256').update(readFileSync(file)).digest('hex');
for(const [src,name] of files){
  const dest=join(archive,name);
  copyFileSync(src,dest);
  chmodSync(dest,0o600);
  if(sha(src)!==sha(dest)) throw new Error(`فشل نسخ ${name}`);
}
writeFileSync(join(archive,'SHA256SUMS'),`${files.map(([,name])=>`${sha(join(archive,name))}  ${name}`).join('\n')}\n`,{mode:0o600});
console.log('تم حفظ دليل تطبيق حفظ المسودة الذري والتحقق من بصماته');
console.log(`ARCHIVE_DIR=${archive}`);
