// Staging-only static UI cutover after the five migrations pass post-apply checks.
// --check performs only read-only checks; no flag publishes with UI-only rollback.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo=fileURLToPath(new URL("../../",import.meta.url));
const source="/tmp/accounting-staging-atomic-ui-source-ojUqj4";
const backup="/opt/backups/accounting-app/staging-inventory-atomic-ui-before-c15lxC";
const live="/var/www/staging.alibea2020.com";
const stagingRef="dunzfxurefzlaamgghys";
const stagingUrl=`https://${stagingRef}.supabase.co`;

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function fileHash(path) { return sha256(readFileSync(path)); }
function run(command,args,options={}) {
  const result=spawnSync(command,args,{
    cwd:repo,encoding:"utf8",timeout:300_000,maxBuffer:16*1024*1024,...options,
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
function currentGuard() {
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
  if (!main.includes(stagingUrl)
      || /https:\/\/(?:farida|alibea)\.alibea2020\.com\/api/.test(main)) {
    throw new Error("عنوان API داخل بناء Staging غير صحيح");
  }
  const key=[...new Set(main.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)??[])].find((candidate)=>{
    try {
      const claims=JSON.parse(Buffer.from(candidate.split(".")[1],"base64url").toString("utf8"));
      return claims.ref===stagingRef && claims.role==="anon" && claims.exp*1000>Date.now();
    } catch { return false; }
  });
  if (!key || sha256(key)!==build.keySha256) throw new Error("مفتاح Staging العام داخل البناء غير متوقع");
  return {guard,build,key};
}
async function verifyKey(key) {
  const response=await fetch(`${stagingUrl}/rest/v1/company_settings?select=id&limit=1`,{
    headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(20_000),
  });
  if (response.status!==200) throw new Error(`رفض API مفتاح Staging العام: HTTP ${response.status}`);
}
async function verifyPublished(build,key) {
  for (const path of ["/","/inventory-adjustments"]) {
    const response=await fetch(`https://staging.alibea2020.com${path}`,{
      cache:"no-store",signal:AbortSignal.timeout(20_000),
    });
    if (response.status!==200 || sha256(Buffer.from(await response.arrayBuffer()))!==build.indexSha256) {
      throw new Error(`فشل تحقق واجهة Staging المنشورة: ${path}`);
    }
  }
  const assetResponse=await fetch(`https://staging.alibea2020.com/${build.mainAsset}`,{
    cache:"no-store",signal:AbortSignal.timeout(20_000),
  });
  if (assetResponse.status!==200
      || sha256(Buffer.from(await assetResponse.arrayBuffer()))!==fileHash(join(build.buildDir,build.mainAsset))) {
    throw new Error("ملف JavaScript المنشور لا يطابق البناء");
  }
  await verifyKey(key);
}
function assertProductionUnchanged(guard) {
  if (fileHash("/var/www/farida/index.html")!==guard.faridaIndexSha256
      || fileHash("/var/www/alibea/index.html")!==guard.alibeaIndexSha256) {
    throw new Error("تغيرت إحدى واجهتي الإنتاج؛ أوقف القطع");
  }
}
function restoreUi() {
  run("rsync",["-a","--no-perms","--delay-updates",
    "--exclude=SHA256SUMS","--exclude=DEPLOY_GUARD.json",`${backup}/`,`${live}/`]);
  normalize(live);
  const guard=JSON.parse(readFileSync(join(backup,"DEPLOY_GUARD.json"),"utf8"));
  if (fileHash(join(live,"index.html"))!==guard.liveIndexSha256) {
    throw new Error("فشل استعادة واجهة Staging القديمة");
  }
}

async function main() {
  const checkOnly=process.argv.length===3 && process.argv[2]==="--check";
  if (!checkOnly && process.argv.length!==2) throw new Error("استخدم --check للفحص دون نشر");
  const {guard,build,key}=currentGuard();
  await verifyKey(key);
  if (checkOnly) {
    console.log("حارس نشر الواجهة جاهز: النسخة والبناء ومفتاح Staging وواجهتا الإنتاج سليمة؛ لم يُنشر شيء");
    return;
  }
  const verification=run("node",["scripts/staging/verify-inventory-atomic-postapply.mjs"]);
  if (!verification.includes("نجح التحقق بعد تطبيق الترحيلات على Staging")) {
    throw new Error("تحقق مخطط Staging غير مكتمل؛ لم يُنشر شيء");
  }
  // Recheck the live UI immediately before copying; the verifier may take time.
  currentGuard();
  let copied=false;
  try {
    copied=true;
    run("rsync",["-a","--delay-updates",`${build.buildDir}/`,`${live}/`]);
    normalize(live);
    if (fileHash(join(live,"index.html"))!==build.indexSha256
        || fileHash(join(live,build.mainAsset))!==fileHash(join(build.buildDir,build.mainAsset))) {
      throw new Error("الملفات المنسوخة لا تطابق البناء المعتمد");
    }
    await verifyPublished(build,key);
    assertProductionUnchanged(guard);
  } catch(error) {
    if (copied) {
      try { restoreUi(); }
      catch(restoreError) { throw new Error(`فشل النشر واستعادة الواجهة: ${error.message}; ${restoreError.message}`); }
      throw new Error(`فشل نشر الواجهة واستُعيدت نسختها السابقة. قاعدة Staging محدثة؛ أوقف ترحيل التسويات حتى التشخيص. السبب: ${error.message}`);
    }
    throw error;
  }
  const report=join(backup,"deploy-report.json");
  writeFileSync(report,`${JSON.stringify({
    result:"STAGING_ATOMIC_UI_DEPLOY_OK",createdAt:new Date().toISOString(),
    buildDir:build.buildDir,mainAsset:build.mainAsset,indexSha256:build.indexSha256,
    oldIndexSha256:guard.liveIndexSha256,productionUiUnchanged:true,
  },null,2)}\n`,{mode:0o600});
  console.log("نُشرت واجهة التسوية الذرية على Staging وتحققت الصفحة والأصل وAPI؛ واجهتا الإنتاج لم تتغيرا");
  console.log(`MAIN_ASSET=${build.mainAsset}`);
  console.log(`INDEX_SHA256=${build.indexSha256}`);
}

main().catch((error)=>{ console.error(error.message); process.exitCode=1; });
