// Build only the atomic-adjustment UI on an isolated copy of the current feature branch.
// Never deploy from the working tree: it may contain unrelated edits.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const expectedHead = "33e01f5815d9609a573dbf5a638eab49ef6968c9";
const stagingRef = "dunzfxurefzlaamgghys";
const stagingUrl = `https://${stagingRef}.supabase.co`;
const liveRoot = "/var/www/staging.alibea2020.com";
const overlay = [
  "src/pages/InventoryAdjustmentForm.tsx",
  "src/pages/InventoryAdjustments.tsx",
  "src/lib/inventory-adjustment-atomic.ts",
  "src/lib/inventory-adjustment-number.ts",
];

function run(command, args, options={}) {
  const result=spawnSync(command,args,{
    cwd:repo,encoding:"utf8",timeout:300_000,maxBuffer:64*1024*1024,...options,
  });
  if (result.status!==0 || result.error) {
    throw new Error(`${command} فشل: ${result.stderr?.trim() || result.error?.message || "خطأ غير معروف"}`);
  }
  return result.stdout?.trim() ?? "";
}

function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function publicKeyFromLiveAsset() {
  const index=readFileSync(join(liveRoot,"index.html"),"utf8");
  const asset=index.match(/src="\/(assets\/index-[^"]+\.js)"/)?.[1];
  if (!asset) throw new Error("تعذر تحديد أصل Staging الحالي");
  const js=readFileSync(join(liveRoot,asset),"utf8");
  if (!js.includes(stagingUrl)) throw new Error("واجهة Staging الحالية لا تشير إلى مشروع الاختبار المتوقع");
  const candidates=[...new Set(js.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)??[])];
  const key=candidates.find((candidate)=>{
    try {
      const claims=JSON.parse(Buffer.from(candidate.split(".")[1],"base64url").toString("utf8"));
      return claims.role==="anon" && claims.ref===stagingRef && claims.exp*1000>Date.now();
    } catch { return false; }
  });
  if (!key) throw new Error("مفتاح Staging العام غير صالح أو غير موجود في البناء الحالي");
  return key;
}

async function verifyKey(key) {
  const response=await fetch(`${stagingUrl}/rest/v1/company_settings?select=id&limit=1`,{
    headers:{apikey:key,Authorization:`Bearer ${key}`},
    signal:AbortSignal.timeout(20_000),
  });
  if (response.status!==200) throw new Error(`رفض API مفتاح Staging العام: HTTP ${response.status}`);
}

function normalize(path) {
  chmodSync(path,0o755);
  for (const entry of readdirSync(path,{withFileTypes:true})) {
    const target=join(path,entry.name);
    if (entry.isDirectory()) normalize(target);
    else chmodSync(target,0o644);
  }
}

async function main() {
  if (process.argv.length!==2) throw new Error("هذا المشغل لا يقبل معاملات");
  if (run("git",["branch","--show-current"])!=="feature/inventory-control-staging"
      || run("git",["rev-parse","HEAD"])!==expectedHead) {
    throw new Error("الفرع أو الالتزام تغيّر؛ أوقف البناء لحين المراجعة");
  }
  if (readFileSync(join(repo,"supabase/.temp/project-ref"),"utf8").trim()!==stagingRef) {
    throw new Error("المشروع المرتبط ليس Staging");
  }
  const key=publicKeyFromLiveAsset();
  await verifyKey(key);
  process.umask(0o077);
  const sourceDir=mkdtempSync("/tmp/accounting-staging-atomic-ui-source-");
  const archivePath=join(sourceDir,"source.tar");
  run("git",["archive","--format=tar","--output",archivePath,expectedHead]);
  run("tar",["-xf",archivePath,"-C",sourceDir]);
  unlinkSync(archivePath);
  for (const path of overlay) copyFileSync(join(repo,path),join(sourceDir,path));
  symlinkSync(join(repo,"node_modules"),join(sourceDir,"node_modules"),"dir");

  const buildDir=mkdtempSync("/tmp/accounting-staging-atomic-ui-build-");
  const result=spawnSync("npm",["run","build","--","--outDir",buildDir,"--emptyOutDir"],{
    cwd:sourceDir,
    env:{
      ...process.env,
      VITE_SUPABASE_URL:stagingUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY:key,
      VITE_APP_ENV:"staging",
      VITE_APP_BASE_PATH:"/",
    },
    encoding:"utf8",timeout:300_000,maxBuffer:64*1024*1024,
  });
  if (result.status!==0 || result.error) {
    const log=join(buildDir,"build.log");
    writeFileSync(log,`${result.stdout??""}\n${result.stderr??""}\n${result.error?.message??""}\n`,{mode:0o600});
    throw new Error(`فشل بناء Staging المعزول؛ التشخيص المحمي: ${log}`);
  }
  normalize(buildDir);
  const builtIndex=readFileSync(join(buildDir,"index.html"),"utf8");
  const mainAsset=builtIndex.match(/src="\/(assets\/index-[^"]+\.js)"/)?.[1];
  if (!mainAsset) throw new Error("ملف JavaScript الرئيسي مفقود من البناء");
  const mainJs=readFileSync(join(buildDir,mainAsset),"utf8");
  if (!mainJs.includes(stagingUrl) || !mainJs.includes(key)) {
    throw new Error("فشل حاجز هوية مشروع Staging داخل البناء");
  }
  const jsFiles=readdirSync(join(buildDir,"assets")).filter((name)=>name.endsWith(".js"));
  const text=jsFiles.map((name)=>readFileSync(join(buildDir,"assets",name),"utf8")).join("\n");
  if (!text.includes("post_inventory_adjustment_atomic")
      || !text.includes("reverse_inventory_adjustment_atomic")
      || text.includes("فشل التراجع عن كمية المنتج")
      || /https:\/\/(?:farida|alibea)\.alibea2020\.com\/api/.test(text)) {
    throw new Error("بناء Staging لا يحتوي المسار الذري الجديد أو يتضمن مسارًا قديمًا/إنتاجيًا");
  }
  // Verify the public key extracted from the *built* asset, not only the live one.
  const builtKeys=[...new Set(mainJs.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)??[])];
  if (!builtKeys.includes(key)) throw new Error("مفتاح Staging العام تغير أثناء البناء");
  await verifyKey(key);
  const manifestPath=join(sourceDir,"build-manifest.json");
  writeFileSync(manifestPath,`${JSON.stringify({
    result:"STAGING_ATOMIC_UI_BUILD_READY",commit:expectedHead,sourceDir,buildDir,
    mainAsset,indexSha256:sha256(join(buildDir,"index.html")),
    liveIndexSha256:sha256(join(liveRoot,"index.html")),
    keySha256:createHash("sha256").update(key).digest("hex"),
    overlays:Object.fromEntries(overlay.map((path)=>[path,sha256(join(repo,path))])),
    createdAt:new Date().toISOString(),
  },null,2)}\n`,{mode:0o600});
  console.log("بناء واجهة Staging المعزول جاهز دون نشر، وتحقق مفتاح المشروع ومسار التسوية الذري");
  console.log(`SOURCE_DIR=${sourceDir}`);
  console.log(`BUILD_DIR=${buildDir}`);
  console.log(`MAIN_ASSET=${mainAsset}`);
  console.log(`INDEX_SHA256=${sha256(join(buildDir,"index.html"))}`);
  console.log(`FILES=${jsFiles.length} JavaScript assets; INDEX_BYTES=${statSync(join(buildDir,"index.html")).size}`);
}

if (process.argv[1]===fileURLToPath(import.meta.url)) {
  main().catch((error)=>{ console.error(error.message); process.exitCode=1; });
}
