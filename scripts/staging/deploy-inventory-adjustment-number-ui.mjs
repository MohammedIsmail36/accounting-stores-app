// Staging-only UI deployment after the official adjustment-number migration.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo=fileURLToPath(new URL("../../",import.meta.url));
const source="/tmp/accounting-staging-atomic-ui-source-COwlZg";
const backup="/opt/backups/accounting-app/staging-inventory-atomic-ui-before-Cg9F3L";
const live="/var/www/staging.alibea2020.com";
const stagingRef="dunzfxurefzlaamgghys";
const stagingUrl=`https://${stagingRef}.supabase.co`;
const draftId="4ddbc584-f277-4a35-8eae-a41cdc841358";

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function fileHash(path) { return sha256(readFileSync(path)); }
function run(command,args,options={}) {
  const result=spawnSync(command,args,{
    cwd:repo,encoding:"utf8",timeout:300000,maxBuffer:32*1024*1024,...options,
  });
  if (result.status!==0 || result.error) {
    throw new Error(`${command} فشل: ${result.stderr?.trim()||result.error?.message||"خطأ غير معروف"}`);
  }
  return result.stdout??"";
}
function normalize(dir) {
  chmodSync(dir,0o755);
  for (const entry of readdirSync(dir,{withFileTypes:true})) {
    const path=join(dir,entry.name);
    if (entry.isDirectory()) normalize(path);
    else chmodSync(path,0o644);
  }
}
function guardState() {
  const guard=JSON.parse(readFileSync(join(backup,"DEPLOY_GUARD.json"),"utf8"));
  const build=JSON.parse(readFileSync(join(source,"build-manifest.json"),"utf8"));
  if (guard.result!=="STAGING_ATOMIC_UI_BACKUP_OK" || build.result!=="STAGING_ATOMIC_UI_BUILD_READY"
      || !build.buildDir?.startsWith("/tmp/accounting-staging-atomic-ui-build-")
      || fileHash(join(live,"index.html"))!==guard.liveIndexSha256
      || fileHash(join(build.buildDir,"index.html"))!==guard.buildIndexSha256
      || fileHash("/var/www/farida/index.html")!==guard.faridaIndexSha256
      || fileHash("/var/www/alibea/index.html")!==guard.alibeaIndexSha256
      || statSync(build.buildDir).mode%0o1000!==0o755) {
    throw new Error("تغيرت نسخة الواجهة أو البناء أو إحدى واجهتي الإنتاج");
  }
  run("sha256sum",["-c","--quiet","SHA256SUMS"],{cwd:backup});
  run("diff",["-qr","--exclude=SHA256SUMS","--exclude=DEPLOY_GUARD.json",live,backup]);
  const main=readFileSync(join(build.buildDir,build.mainAsset),"utf8");
  if (!main.includes(stagingUrl) || /https:\/\/(?:farida|alibea)\.alibea2020\.com\/api/.test(main)) {
    throw new Error("هوية API داخل البناء غير صحيحة");
  }
  const key=[...new Set(main.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)??[])].find((candidate)=>{
    try {
      const claims=JSON.parse(Buffer.from(candidate.split(".")[1],"base64url").toString("utf8"));
      return claims.ref===stagingRef && claims.role==="anon" && claims.exp*1000>Date.now();
    } catch { return false; }
  });
  if (!key || sha256(key)!==build.keySha256) throw new Error("مفتاح Staging العام غير متوقع");
  return {guard,build,key};
}
function assertDatabaseReady() {
  if (readFileSync(join(repo,"supabase/.temp/project-ref"),"utf8").trim()!==stagingRef) {
    throw new Error("المشروع المرتبط ليس Staging");
  }
  const output=run("npx",["-y","supabase@2.116.0","db","query","--linked","--output-format","json",
    "--file","/tmp/inventory-adjustment-number-postapply.sql"]);
  const parsed=JSON.parse(output.slice(output.indexOf("{"),output.lastIndexOf("}")+1));
  const state=parsed.rows?.find(row=>row.numbering_state)?.numbering_state;
  if (state?.database!=="postgres" || !state.version?.startsWith("17.")
      || !state.migration_present || !state.posted_column || !state.unique_index
      || !state.number_helper || !state.write_guard || !state.base_has_allocation
      || !state.base_has_official_description || !state.reverse_has_official_description
      || Number(state.operation_count)!==0 || Number(state.official_number_count)!==0
      || state.draft?.id!==draftId || state.draft?.status!=="draft"
      || state.draft?.posted_number!==null || state.draft?.journal_id!==null) {
    throw new Error("حالة ترقيم التسوية على Staging غير متوقعة؛ أُلغي النشر");
  }
}
async function verifyPublished(build,key) {
  for (const path of ["/","/inventory-adjustments",`/inventory-adjustments/${draftId}`]) {
    const response=await fetch(`https://staging.alibea2020.com${path}`,{
      cache:"no-store",signal:AbortSignal.timeout(20000),
    });
    if (response.status!==200 || sha256(Buffer.from(await response.arrayBuffer()))!==build.indexSha256) {
      throw new Error(`فشل تحقق الواجهة المنشورة: ${path}`);
    }
  }
  const asset=await fetch(`https://staging.alibea2020.com/${build.mainAsset}`,{
    cache:"no-store",signal:AbortSignal.timeout(20000),
  });
  if (asset.status!==200 || sha256(Buffer.from(await asset.arrayBuffer()))!==fileHash(join(build.buildDir,build.mainAsset))) {
    throw new Error("أصل JavaScript المنشور لا يطابق البناء");
  }
  const api=await fetch(`${stagingUrl}/rest/v1/company_settings?select=id&limit=1`,{
    headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(20000),
  });
  if (api.status!==200) throw new Error(`فشل مفتاح Staging العام: HTTP ${api.status}`);
}
async function main() {
  const checkOnly=process.argv.length===3 && process.argv[2]==="--check";
  if (!checkOnly && process.argv.length!==2) throw new Error("استخدم --check للفحص دون نشر");
  const {guard,build,key}=guardState();
  assertDatabaseReady();
  if (checkOnly) { console.log("حارس نشر Staging جاهز؛ لم يُنشر شيء"); return; }
  guardState();
  let copied=false;
  try {
    copied=true;
    run("rsync",["-a","--delay-updates",`${build.buildDir}/`,`${live}/`]);
    normalize(live);
    if (fileHash(join(live,"index.html"))!==build.indexSha256) throw new Error("index.html لا يطابق البناء");
    await verifyPublished(build,key);
    if (fileHash("/var/www/farida/index.html")!==guard.faridaIndexSha256
        || fileHash("/var/www/alibea/index.html")!==guard.alibeaIndexSha256) {
      throw new Error("تغيرت إحدى واجهتي الإنتاج");
    }
  } catch(error) {
    if (copied) {
      run("rsync",["-a","--no-perms","--delay-updates",
        "--exclude=SHA256SUMS","--exclude=DEPLOY_GUARD.json",`${backup}/`,`${live}/`]);
      normalize(live);
      if (fileHash(join(live,"index.html"))!==guard.liveIndexSha256) {
        throw new Error(`فشل النشر والرجوع: ${error.message}`);
      }
      throw new Error(`فشل نشر الواجهة واستُعيدت نسختها السابقة: ${error.message}`);
    }
    throw error;
  }
  writeFileSync(join(backup,"deploy-report.json"),`${JSON.stringify({
    result:"STAGING_ADJUSTMENT_NUMBER_UI_OK",createdAt:new Date().toISOString(),
    mainAsset:build.mainAsset,indexSha256:build.indexSha256,productionUiUnchanged:true,
  },null,2)}\n`,{mode:0o600});
  console.log("نُشر إصلاح ترحيل وتسلسل التسويات وعرض المنتج على Staging؛ واجهتا الإنتاج لم تتغيرا");
  console.log(`MAIN_ASSET=${build.mainAsset}`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
