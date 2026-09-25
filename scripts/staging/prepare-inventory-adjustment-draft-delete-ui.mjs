// Isolated build from the pinned feature commit; never includes dirty worktree files.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo='/opt/accounting-app';
const commit='8032cb302bf3021be24ae8dca0c6b4ddfbd245c6';
const ref='dunzfxurefzlaamgghys';
const api=`https://${ref}.supabase.co`;
const live='/var/www/staging.alibea2020.com';
function run(command,args,options={}) {
  const result=spawnSync(command,args,{cwd:repo,encoding:'utf8',timeout:300000,
    maxBuffer:64*1024*1024,...options});
  if(result.error || result.status!==0) throw new Error(result.stderr?.trim()||result.error?.message||`${command} failed`);
  return result.stdout?.trim()??'';
}
const sha=(value)=>createHash('sha256').update(value).digest('hex');
function normalize(dir) {
  chmodSync(dir,0o755);
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    const path=join(dir,entry.name);
    if(entry.isDirectory()) normalize(path);
    else chmodSync(path,0o644);
  }
}
function liveKey() {
  const index=readFileSync(join(live,'index.html'),'utf8');
  const asset=index.match(/src="\/(assets\/index-[^"]+\.js)"/)?.[1];
  if(!asset) throw new Error('أصل Staging الحالي غير معروف');
  const js=readFileSync(join(live,asset),'utf8');
  if(!js.includes(api)) throw new Error('واجهة Staging لا تشير إلى مشروع الاختبار');
  const candidates=[...new Set(js.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)??[])];
  const key=candidates.find((candidate)=>{
    try {
      const payload=JSON.parse(Buffer.from(candidate.split('.')[1],'base64url').toString('utf8'));
      return payload.ref===ref && payload.role==='anon' && payload.exp*1000>Date.now();
    } catch { return false; }
  });
  if(!key) throw new Error('مفتاح Staging العام غير صالح');
  return key;
}
async function main() {
  if(run('git',['branch','--show-current'])!=='feature/inventory-control-staging'
     || run('git',['rev-parse','HEAD'])!==commit
     || readFileSync(join(repo,'supabase/.temp/project-ref'),'utf8').trim()!==ref) {
    throw new Error('الفرع أو الالتزام أو المشروع المرتبط تغير');
  }
  const key=liveKey();
  const response=await fetch(`${api}/rest/v1/company_settings?select=id&limit=1`,{
    headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(20000),
  });
  if(response.status!==200) throw new Error(`رفض API المفتاح العام: ${response.status}`);
  process.umask(0o077);
  const source=mkdtempSync('/tmp/accounting-staging-draft-delete-source-');
  const tar=join(source,'source.tar');
  run('git',['archive','--format=tar','--output',tar,commit]);
  run('tar',['-xf',tar,'-C',source]);
  unlinkSync(tar);
  symlinkSync(join(repo,'node_modules'),join(source,'node_modules'),'dir');
  const build=mkdtempSync('/tmp/accounting-staging-draft-delete-build-');
  const result=spawnSync('npm',['run','build','--','--outDir',build,'--emptyOutDir'],{
    cwd:source,env:{...process.env,VITE_SUPABASE_URL:api,
      VITE_SUPABASE_PUBLISHABLE_KEY:key,VITE_APP_ENV:'staging',VITE_APP_BASE_PATH:'/'},
    encoding:'utf8',timeout:300000,maxBuffer:64*1024*1024,
  });
  if(result.error || result.status!==0) {
    writeFileSync(join(build,'build.log'),`${result.stdout??''}\n${result.stderr??''}\n${result.error?.message??''}\n`,{mode:0o600});
    throw new Error(`فشل البناء؛ التشخيص: ${build}/build.log`);
  }
  normalize(build);
  const index=readFileSync(join(build,'index.html'),'utf8');
  const mainAsset=index.match(/src="\/(assets\/index-[^"]+\.js)"/)?.[1];
  if(!mainAsset) throw new Error('ملف JavaScript الرئيسي مفقود');
  const allJs=readdirSync(join(build,'assets')).filter((name)=>name.endsWith('.js'))
    .map((name)=>readFileSync(join(build,'assets',name),'utf8')).join('\n');
  if(!allJs.includes(api) || !allJs.includes(key)
     || !allJs.includes('delete_inventory_adjustment_draft')
     || !allJs.includes('save_inventory_adjustment_draft')
     || /https:\/\/(?:farida|alibea)\.alibea2020\.com\/api/.test(allJs)) {
    throw new Error('هوية البناء أو مدخل الحذف غير صحيحة');
  }
  const manifest={result:'STAGING_DRAFT_DELETE_UI_BUILD_READY',commit,source,build,
    mainAsset,indexSha256:sha(readFileSync(join(build,'index.html'))),
    liveIndexSha256:sha(readFileSync(join(live,'index.html'))),
    keySha256:sha(key),createdAt:new Date().toISOString()};
  writeFileSync(join(source,'build-manifest.json'),`${JSON.stringify(manifest,null,2)}\n`,{mode:0o600});
  console.log('بناء Staging المعزول جاهز دون نشر؛ تحقق رابط API ومدخل حذف المسودة');
  console.log(`SOURCE_DIR=${source}`);
  console.log(`BUILD_DIR=${build}`);
  console.log(`MAIN_ASSET=${mainAsset}`);
}
main().catch((error)=>{console.error(error.message);process.exitCode=1;});
