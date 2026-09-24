// Preserve Staging cutover evidence and exact SQL sources without exposing keys.
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo=fileURLToPath(new URL("../../",import.meta.url));
const parent="/backups/staging/inventory-atomic-variance-before-XfEaux";
const files=[
  ["preflight-report.json","/tmp/accounting-staging-atomic-cutover-preflight-kcYuUm/report.json"],
  ["postapply-report.json","/tmp/accounting-staging-atomic-postapply-EOS6vm/report.json"],
  ["ui-deploy-report.json","/opt/backups/accounting-app/staging-inventory-atomic-ui-before-c15lxC/deploy-report.json"],
  ["ui-build-manifest.json","/tmp/accounting-staging-atomic-ui-source-ojUqj4/build-manifest.json"],
  ["cutover-plan.md",join(repo,"docs/INVENTORY_ATOMIC_VARIANCE_STAGING_CUTOVER_PLAN_2026-09-24.md")],
  ...[
    "20260924100000_inventory_atomic_variance_engine.sql",
    "20260924101000_inventory_atomic_variance_hardening.sql",
    "20260924102000_inventory_atomic_variance_zero_balance_guard.sql",
    "20260924103000_inventory_atomic_variance_write_guard.sql",
    "20260924104000_inventory_atomic_variance_diagnostic_compat.sql",
  ].flatMap((name)=>[[`migration-${name}`,join(repo,"supabase/migrations",name)],
                      [`rollback-${name}`,join(repo,"supabase/rollback",name)]]),
];
function hash(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function main() {
  if (process.argv.length!==2) throw new Error("هذا المشغل لا يقبل معاملات");
  const preflight=JSON.parse(readFileSync(files[0][1],"utf8"));
  const postapply=JSON.parse(readFileSync(files[1][1],"utf8"));
  const deploy=JSON.parse(readFileSync(files[2][1],"utf8"));
  if (preflight.result!=="STAGING_ATOMIC_CUTOVER_PREFLIGHT_OK"
      || postapply.result!=="STAGING_ATOMIC_POSTAPPLY_OK"
      || deploy.result!=="STAGING_ATOMIC_UI_DEPLOY_OK") {
    throw new Error("دليل القطع غير مكتمل؛ رفض الأرشفة");
  }
  process.umask(0o077);
  const dir=mkdtempSync(join(parent,"cutover-proof-"));
  chmodSync(dir,0o700);
  const lines=[];
  for (const [name,source] of files) {
    const target=join(dir,name);
    copyFileSync(source,target);
    chmodSync(target,0o600);
    if (hash(target)!==hash(source)) throw new Error(`فشلت مطابقة الأرشيف: ${name}`);
    lines.push(`${hash(target)}  ${name}`);
  }
  const sums=join(dir,"SHA256SUMS");
  writeFileSync(sums,`${lines.join("\n")}\n`,{mode:0o600});
  if (statSync(sums).size<100) throw new Error("ملف البصمات غير مكتمل");
  console.log("حُفظ دليل تطبيق Staging وبصمات ملفات SQL وخطة القطع بنجاح");
  console.log(`ARCHIVE_DIR=${dir}`);
}
if (process.argv[1]===fileURLToPath(import.meta.url)) {
  try { main(); } catch(error) { console.error(error.message); process.exitCode=1; }
}
