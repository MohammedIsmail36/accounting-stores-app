import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [source,backup,dbBackup,mode]=process.argv.slice(2);
if(!source?.startsWith('/tmp/accounting-staging-draft-delete-source-')
  || !backup?.startsWith('/opt/backups/accounting-app/staging-inventory-draft-delete-ui-before-')
  || !dbBackup?.startsWith('/backups/staging/inventory-draft-delete-before-')
  || (mode!==undefined && mode!=='--check')) {
  throw new Error('حدد مصدر البناء ونسخة الواجهة ونسخة القاعدة؛ --check للفحص فقط');
}
const root='/opt/accounting-app';
const live='/var/www/staging.alibea2020.com';
const ref='dunzfxurefzlaamgghys';
const api=`https://${ref}.supabase.co`;
const sha=(value)=>createHash('sha256').update(value).digest('hex');
const fileHash=(file)=>sha(readFileSync(file));
function run(command,args,options={}) {
  const result=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:300000,
    maxBuffer:32*1024*1024,...options});
  if(result.error || result.status!==0) throw new Error(result.stderr?.trim()||result.error?.message||`${command} failed`);
  return result.stdout??'';
}
function normalize(dir) {
  chmodSync(dir,0o755);
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    const path=join(dir,entry.name);
    if(entry.isDirectory()) normalize(path);
    else chmodSync(path,0o644);
  }
}
const guard=JSON.parse(readFileSync(join(backup,'DEPLOY_GUARD.json'),'utf8'));
const build=JSON.parse(readFileSync(join(source,'build-manifest.json'),'utf8'));
if(guard.result!=='STAGING_DRAFT_DELETE_UI_BACKUP_OK'
  || build.result!=='STAGING_DRAFT_DELETE_UI_BUILD_READY'
  || build.commit!==run('git',['rev-parse','HEAD']).trim()
  || build.source!==source || guard.source!==source || guard.build!==build.build
  || readFileSync(join(root,'supabase/.temp/project-ref'),'utf8').trim()!==ref) {
  throw new Error('هوية البناء أو النسخة أو Staging غير متوقعة');
}
function guardState() {
  run('sha256sum',['-c','--quiet','SHA256SUMS'],{cwd:backup});
  run('diff',['-qr','--exclude=SHA256SUMS','--exclude=DEPLOY_GUARD.json',live,backup]);
  if(fileHash(join(live,'index.html'))!==guard.liveIndexSha256
     || fileHash(join(build.build,'index.html'))!==guard.buildIndexSha256
     || fileHash('/var/www/farida/index.html')!==guard.faridaIndexSha256
     || fileHash('/var/www/alibea/index.html')!==guard.alibeaIndexSha256
     || statSync(build.build).mode%0o1000!==0o755) {
    throw new Error('تغيرت واجهة Staging أو البناء أو إحدى واجهتي الإنتاج');
  }
  const js=readFileSync(join(build.build,build.mainAsset),'utf8');
  const candidates=[...new Set(js.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)??[])];
  const key=candidates.find((candidate)=>{
    try {
      const payload=JSON.parse(Buffer.from(candidate.split('.')[1],'base64url').toString('utf8'));
      return payload.ref===ref && payload.role==='anon' && payload.exp*1000>Date.now();
    } catch { return false; }
  });
  const allJs=readdirSync(join(build.build,'assets')).filter((name)=>name.endsWith('.js'))
    .map((name)=>readFileSync(join(build.build,'assets',name),'utf8')).join('\n');
  if(!js.includes(api) || !allJs.includes('delete_inventory_adjustment_draft')
    || !key || sha(key)!==build.keySha256) throw new Error('API أو المفتاح أو RPC داخل البناء غير صحيح');
  return key;
}
async function verify(key) {
  for(const path of ['/','/inventory-adjustments','/inventory-adjustments/new']) {
    const response=await fetch(`https://staging.alibea2020.com${path}`,{
      cache:'no-store',signal:AbortSignal.timeout(20000),
    });
    if(response.status!==200 || sha(Buffer.from(await response.arrayBuffer()))!==build.indexSha256) {
      throw new Error(`فشل استجابة الواجهة: ${path}`);
    }
  }
  const asset=await fetch(`https://staging.alibea2020.com/${build.mainAsset}`,{
    cache:'no-store',signal:AbortSignal.timeout(20000),
  });
  if(asset.status!==200 || sha(Buffer.from(await asset.arrayBuffer()))!==fileHash(join(build.build,build.mainAsset))) {
    throw new Error('الأصل المنشور لا يطابق البناء');
  }
  const response=await fetch(`${api}/rest/v1/company_settings?select=id&limit=1`,{
    headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(20000),
  });
  if(response.status!==200) throw new Error(`رفض مفتاح Staging العام: ${response.status}`);
  if(fileHash('/var/www/farida/index.html')!==guard.faridaIndexSha256
     || fileHash('/var/www/alibea/index.html')!==guard.alibeaIndexSha256) {
    throw new Error('تغيرت إحدى واجهتي الإنتاج');
  }
}
async function main() {
  const key=guardState();
  const db=run('node',['scripts/staging/verify-inventory-adjustment-draft-delete-postapply.mjs',dbBackup]);
  if(!db.includes('نجح التحقق')) throw new Error('القاعدة لم تجتز التحقق قبل النشر');
  if(mode==='--check') { console.log('حارس نشر Staging جاهز؛ لم يُنشر شيء'); return; }
  guardState();
  let copied=false;
  try {
    copied=true;
    run('rsync',['-a','--delay-updates',`${build.build}/`,`${live}/`]);
    normalize(live);
    if(fileHash(join(live,'index.html'))!==build.indexSha256) throw new Error('index.html لا يطابق البناء');
    await verify(key);
  } catch(error) {
    if(copied) {
      run('rsync',['-a','--no-perms','--delay-updates','--exclude=SHA256SUMS',
        '--exclude=DEPLOY_GUARD.json',`${backup}/`,`${live}/`]);
      normalize(live);
      if(fileHash(join(live,'index.html'))!==guard.liveIndexSha256) {
        throw new Error(`فشل النشر والرجوع: ${error.message}`);
      }
      throw new Error(`فشل النشر واستُعيدت واجهة Staging السابقة: ${error.message}`);
    }
    throw error;
  }
  writeFileSync(join(backup,'deploy-report.json'),`${JSON.stringify({
    result:'STAGING_DRAFT_DELETE_UI_DEPLOYED',deployedAt:new Date().toISOString(),
    buildCommit:build.commit,mainAsset:build.mainAsset,indexSha256:build.indexSha256,
    faridaUntouched:true,alibeaUntouched:true,
  },null,2)}\n`,{mode:0o600});
  console.log('تم نشر حذف المسودة الذري على Staging والتحقق من الواجهة وAPI');
  console.log(`MAIN_ASSET=${build.mainAsset}`);
  console.log('واجهتا Farida وAlibea لم تتغيرا');
}
main().catch((error)=>{console.error(error.message);process.exitCode=1;});
