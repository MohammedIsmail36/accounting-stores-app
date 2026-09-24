// Final read-only gate immediately before the Staging-only cutover.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStagingLink, queryBaseline, stableBaseline, validateBaseline } from "./backup-inventory-atomic-variance-baseline.mjs";

const repo=fileURLToPath(new URL("../../",import.meta.url));
const dbBackup="/backups/staging/inventory-atomic-variance-before-XfEaux";
const uiBackup="/opt/backups/accounting-app/staging-inventory-atomic-ui-before-c15lxC";
const uiSource="/tmp/accounting-staging-atomic-ui-source-ojUqj4";
const live="/var/www/staging.alibea2020.com";
const expectedFiles=[
  "20260924100000_inventory_atomic_variance_engine.sql",
  "20260924101000_inventory_atomic_variance_hardening.sql",
  "20260924102000_inventory_atomic_variance_zero_balance_guard.sql",
  "20260924103000_inventory_atomic_variance_write_guard.sql",
  "20260924104000_inventory_atomic_variance_diagnostic_compat.sql",
];

function hash(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function run(command,args,options={}) {
  const result=spawnSync(command,args,{cwd:repo,encoding:"utf8",timeout:300_000,maxBuffer:16*1024*1024,...options});
  if (result.status!==0 || result.error) throw new Error(`${command} فشل: ${result.stderr?.trim()||result.error?.message||"خطأ غير معروف"}`);
  return result.stdout??"";
}
function verifySums(path) { run("sha256sum",["-c","--quiet","SHA256SUMS"],{cwd:path}); }

function main() {
  if (process.argv.length!==2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStagingLink();
  if (run("git",["branch","--show-current"]).trim()!=="feature/inventory-control-staging"
      || run("git",["rev-parse","HEAD"]).trim()!=="1d6bf86ae0a0832e96841f3280d704941bc4b63f") {
    throw new Error("الفرع أو الالتزام الأساسي تغير");
  }
  verifySums(dbBackup);
  verifySums(uiBackup);
  const rehearsal=JSON.parse(readFileSync(join(dbBackup,"transactional-rehearsal-PL0LEd/report.json"),"utf8"));
  const acceptance=JSON.parse(readFileSync(join(dbBackup,"transactional-acceptance-iJ5UgE/report.json"),"utf8"));
  if (rehearsal.result!=="STAGING_ATOMIC_VARIANCE_REHEARSAL_OK"
      || !rehearsal.baselineUnchanged || acceptance.result!=="STAGING_ATOMIC_VARIANCE_ACCEPTANCE_OK"
      || !acceptance.baselineUnchanged) throw new Error("دليل التجربة أو القبول غير مكتمل");
  for (const [path,expected] of Object.entries(rehearsal.sourceHashes)) {
    // The first rehearsal report accidentally dropped the initial "s" from
    // "supabase/" in its displayed path. Verify its hash against the only
    // permitted corrected path; never accept arbitrary paths from the report.
    if (!path.startsWith("upabase/") || !expectedFiles.includes(path.split("/").at(-1))) {
      throw new Error(`مسار دليل SQL غير متوقع: ${path}`);
    }
    if (hash(join(repo,`s${path}`))!==expected) throw new Error(`تغير ملف ترحيل أو رجوع: ${path}`);
  }
  const guard=JSON.parse(readFileSync(join(uiBackup,"DEPLOY_GUARD.json"),"utf8"));
  const build=JSON.parse(readFileSync(join(uiSource,"build-manifest.json"),"utf8"));
  if (guard.result!=="STAGING_ATOMIC_UI_BACKUP_OK" || build.result!=="STAGING_ATOMIC_UI_BUILD_READY"
      || hash(join(live,"index.html"))!==guard.liveIndexSha256
      || hash(join(build.buildDir,"index.html"))!==guard.buildIndexSha256
      || hash("/var/www/farida/index.html")!==guard.faridaIndexSha256
      || hash("/var/www/alibea/index.html")!==guard.alibeaIndexSha256) {
    throw new Error("تغيرت الواجهة الحية أو البناء أو إحدى واجهتي الإنتاج");
  }
  for (const [path,expected] of Object.entries(build.overlays)) {
    if (hash(join(repo,path))!==expected) throw new Error(`تغير مصدر الواجهة: ${path}`);
  }
  run("diff",["-qr","--exclude=SHA256SUMS","--exclude=DEPLOY_GUARD.json",live,uiBackup]);
  process.umask(0o077);
  const dir=mkdtempSync("/tmp/accounting-staging-atomic-cutover-preflight-");
  chmodSync(dir,0o700);
  const expected=validateBaseline(JSON.parse(readFileSync(join(dbBackup,"baseline.json"),"utf8")));
  const current=queryBaseline(join(dir,"run.log"));
  if (JSON.stringify(stableBaseline(current))!==JSON.stringify(stableBaseline(expected))) {
    throw new Error("تغير خط أساس Staging منذ النسخة الاحتياطية؛ أوقف القطع");
  }
  const stdout=run("npx",["-y","supabase@2.116.0","db","push","--linked","--skip-vault","--dry-run","--output-format","json"]);
  const row=stdout.match(/\{"upToDate":false,"dryRun":true,[^\n]+\}/)?.[0];
  if (!row) throw new Error("لم يُقرأ ملخص الفحص الجاف للترحيلات");
  const dryRun=JSON.parse(row);
  if (JSON.stringify(dryRun.migrations)!==JSON.stringify(expectedFiles)
      || dryRun.seeds.length!==0 || dryRun.roles.length!==0) {
    throw new Error("قائمة الترحيلات أو الأدوار أو البذور غير متوقعة");
  }
  const report=join(dir,"report.json");
  writeFileSync(report,`${JSON.stringify({
    result:"STAGING_ATOMIC_CUTOVER_PREFLIGHT_OK",createdAt:new Date().toISOString(),
    dbBackup,uiBackup,buildDir:build.buildDir,
    branch:"feature/inventory-control-staging",commit:build.commit,
    migrations:dryRun.migrations,baselineUnchanged:true,uiUnchanged:true,
    productionUiUnchanged:true,readOnly:true,
  },null,2)}\n`,{mode:0o600});
  console.log("اجتاز القطع بوابة القراءة فقط: النسخ والبصمات والفرع وقائمة الترحيلات الخمسة وخط الأساس سليمة");
  console.log(`PREFLIGHT_DIR=${dir}`);
}

if (process.argv[1]===fileURLToPath(import.meta.url)) {
  try { main(); } catch(error) { console.error(error.message); process.exitCode=1; }
}
