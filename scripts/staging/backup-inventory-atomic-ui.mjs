// Read-only copy of the currently served Staging UI before Phase 3 cutover.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const live="/var/www/staging.alibea2020.com";
const backupParent="/opt/backups/accounting-app";

function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function run(command,args) {
  const result=spawnSync(command,args,{encoding:"utf8",timeout:120_000,maxBuffer:8*1024*1024});
  if (result.status!==0 || result.error) {
    throw new Error(`${command} فشل: ${result.stderr?.trim()||result.error?.message||"خطأ غير معروف"}`);
  }
}

function listFiles(dir) {
  const files=[];
  for (const entry of readdirSync(dir,{withFileTypes:true})) {
    const path=join(dir,entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`عنصر غير متوقع في واجهة Staging: ${path}`);
  }
  return files;
}

function protect(dir) {
  chmodSync(dir,0o700);
  for (const entry of readdirSync(dir,{withFileTypes:true})) {
    const path=join(dir,entry.name);
    if (entry.isDirectory()) protect(path);
    else chmodSync(path,0o600);
  }
}

function main() {
  if (process.argv.length!==3) throw new Error("الاستخدام: node backup-inventory-atomic-ui.mjs SOURCE_DIR");
  const source=process.argv[2];
  if (!source.startsWith("/tmp/accounting-staging-atomic-ui-source-")) {
    throw new Error("مسار مصدر البناء المعزول غير متوقع");
  }
  const buildManifest=JSON.parse(readFileSync(join(source,"build-manifest.json"),"utf8"));
  if (buildManifest.result!=="STAGING_ATOMIC_UI_BUILD_READY"
      || !buildManifest.buildDir?.startsWith("/tmp/accounting-staging-atomic-ui-build-")) {
    throw new Error("بناء الواجهة لم يجتز بوابة التحضير");
  }
  const buildIndex=join(buildManifest.buildDir,"index.html");
  if (sha256(buildIndex)!==buildManifest.indexSha256
      || sha256(join(live,"index.html"))!==buildManifest.liveIndexSha256) {
    throw new Error("تغير البناء أو واجهة Staging منذ التحضير");
  }
  process.umask(0o077);
  const backup=mkdtempSync(join(backupParent,"staging-inventory-atomic-ui-before-"));
  chmodSync(backup,0o700);
  run("rsync",["-a","--no-perms",`${live}/`,`${backup}/`]);
  run("diff",["-qr",live,backup]);
  protect(backup);
  const originalFiles=listFiles(backup).sort();
  const guard={
    result:"STAGING_ATOMIC_UI_BACKUP_OK",
    createdAt:new Date().toISOString(),
    buildDir:buildManifest.buildDir,
    buildIndexSha256:buildManifest.indexSha256,
    liveIndexSha256:buildManifest.liveIndexSha256,
    faridaIndexSha256:sha256("/var/www/farida/index.html"),
    alibeaIndexSha256:sha256("/var/www/alibea/index.html"),
    fileCount:originalFiles.length,
    totalBytes:originalFiles.reduce((sum,path)=>sum+statSync(path).size,0),
  };
  const guardPath=join(backup,"DEPLOY_GUARD.json");
  writeFileSync(guardPath,`${JSON.stringify(guard,null,2)}\n`,{mode:0o600});
  const files=[...originalFiles,guardPath];
  const sumsPath=join(backup,"SHA256SUMS");
  writeFileSync(sumsPath,`${files.map((path)=>`${sha256(path)}  ${relative(backup,path)}`).join("\n")}\n`,{mode:0o600});
  for (const path of files) {
    if (!readFileSync(sumsPath,"utf8").includes(`${sha256(path)}  ${relative(backup,path)}`)) {
      throw new Error("فشل التحقق من ملف النسخة الاحتياطية");
    }
  }
  if (sha256(join(live,"index.html"))!==guard.liveIndexSha256) {
    throw new Error("تغيرت واجهة Staging أثناء النسخ؛ لا تعتمد هذه النسخة");
  }
  console.log("حُفظت نسخة واجهة Staging الحية والتحقق من تطابقها مع المصدر دون نشر");
  console.log(`BACKUP_DIR=${backup}`);
  console.log(`FILES=${guard.fileCount} BYTES=${guard.totalBytes}`);
  console.log(`LIVE_INDEX_SHA256=${guard.liveIndexSha256}`);
  console.log(`BUILD_INDEX_SHA256=${guard.buildIndexSha256}`);
}

if (process.argv[1]===fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode=1; }
}
