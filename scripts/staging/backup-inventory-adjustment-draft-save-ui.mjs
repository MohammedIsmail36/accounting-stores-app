import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const source='/tmp/accounting-staging-draft-save-source-Kaqs1q';
const live='/var/www/staging.alibea2020.com';
const parent='/opt/backups/accounting-app';
const sha=(file)=>createHash('sha256').update(readFileSync(file)).digest('hex');
function files(dir) {
  return readdirSync(dir,{withFileTypes:true}).flatMap((entry)=>{
    const path=join(dir,entry.name);
    if(entry.isDirectory()) return files(path);
    if(entry.isFile()) return [path];
    throw new Error(`عنصر غير متوقع: ${path}`);
  });
}
function protect(dir) {
  chmodSync(dir,0o700);
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    const path=join(dir,entry.name);
    if(entry.isDirectory()) protect(path);
    else chmodSync(path,0o600);
  }
}
function run(command,args) {
  const result=spawnSync(command,args,{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
  if(result.error || result.status!==0) throw new Error(result.stderr?.trim()||result.error?.message||`${command} failed`);
}
const manifest=JSON.parse(readFileSync(join(source,'build-manifest.json'),'utf8'));
if(manifest.result!=='STAGING_DRAFT_SAVE_UI_BUILD_READY'
   || !manifest.build?.startsWith('/tmp/accounting-staging-draft-save-build-')
   || sha(join(manifest.build,'index.html'))!==manifest.indexSha256
   || sha(join(live,'index.html'))!==manifest.liveIndexSha256) {
  throw new Error('البناء أو واجهة Staging تغيرا قبل النسخ');
}
process.umask(0o077);
const backup=mkdtempSync(join(parent,'staging-inventory-draft-save-ui-before-'));
chmodSync(backup,0o700);
run('rsync',['-a','--no-perms',`${live}/`,`${backup}/`]);
run('diff',['-qr',live,backup]);
protect(backup);
const original=files(backup).sort();
const guard={result:'STAGING_DRAFT_SAVE_UI_BACKUP_OK',createdAt:new Date().toISOString(),
  source,build:manifest.build,buildIndexSha256:manifest.indexSha256,
  liveIndexSha256:manifest.liveIndexSha256,
  faridaIndexSha256:sha('/var/www/farida/index.html'),
  alibeaIndexSha256:sha('/var/www/alibea/index.html'),
  fileCount:original.length,totalBytes:original.reduce((n,file)=>n+statSync(file).size,0)};
const guardPath=join(backup,'DEPLOY_GUARD.json');
writeFileSync(guardPath,`${JSON.stringify(guard,null,2)}\n`,{mode:0o600});
writeFileSync(join(backup,'SHA256SUMS'),`${[...original,guardPath]
  .map((file)=>`${sha(file)}  ${relative(backup,file)}`).join('\n')}\n`,{mode:0o600});
if(sha(join(live,'index.html'))!==guard.liveIndexSha256) throw new Error('تغيرت واجهة Staging أثناء النسخ');
console.log('تم حفظ نسخة واجهة Staging والتحقق من تطابقها قبل نشر حفظ المسودة');
console.log(`BACKUP_DIR=${backup}`);
