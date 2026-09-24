// Read-only validation after the five Staging migrations and before UI publication.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStagingLink, queryState } from "./backup-inventory-atomic-variance-baseline.mjs";

const repo=fileURLToPath(new URL("../../",import.meta.url));
const backup="/backups/staging/inventory-atomic-variance-before-XfEaux";
const versions=["20260924100000","20260924101000","20260924102000","20260924103000","20260924104000"];
function hash(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function schemaQuery(log) {
  const result=spawnSync("npx",["-y","supabase@2.116.0","db","query","--linked","--output-format","json","--file",
    join(repo,"scripts/staging/verify-inventory-atomic-postapply.sql")],{
      cwd:repo,encoding:"utf8",timeout:300_000,maxBuffer:16*1024*1024,
    });
  if (result.status!==0 || result.error) {
    writeFileSync(log,`${result.stdout??""}\n${result.stderr??""}\n${result.error?.message??""}\n`,{mode:0o600});
    throw new Error(`فشل استعلام تحقق Staging؛ التشخيص المحمي: ${log}`);
  }
  const raw=result.stdout.slice(result.stdout.indexOf("{"),result.stdout.lastIndexOf("}")+1);
  const state=JSON.parse(raw)?.rows?.find((row)=>row.atomic_schema_state)?.atomic_schema_state;
  if (!state) throw new Error("لم تُقرأ نتيجة تحقق مخطط Staging");
  return state;
}

export function assertSchema(state) {
  const trueFlags=["operations_table","operation_lines_table","post_function","reverse_function",
    "post_security_definer","reverse_security_definer","authenticated_post_execute","authenticated_reverse_execute",
    "zero_balance_guard","header_write_guard","item_write_guard","movement_write_guard"];
  const falseFlags=["anon_post_execute","anon_reverse_execute","authenticated_internal_execute",
    "authenticated_old_quantity_execute"];
  if (state.database!=="postgres" || !state.version?.startsWith("17.")
      || JSON.stringify(state.migrations)!==JSON.stringify(versions)
      || Number(state.operation_count)!==0
      || trueFlags.some((flag)=>state[flag]!==true)
      || falseFlags.some((flag)=>state[flag]!==false)) {
    throw new Error("مخطط التسوية الذرية أو صلاحياته أو حالة الترحيلات غير سليمة");
  }
}

function main() {
  if (process.argv.length!==2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStagingLink();
  process.umask(0o077);
  const dir=mkdtempSync("/tmp/accounting-staging-atomic-postapply-");
  chmodSync(dir,0o700);
  const log=join(dir,"run.log");
  const expected=JSON.parse(readFileSync(join(backup,"baseline.json"),"utf8"));
  const schema=schemaQuery(log);
  assertSchema(schema);
  const actual=queryState(log);
  // The new diagnostic intentionally adds the (currently empty) atomic
  // operation set to its snapshot fingerprint. The hash must change even
  // though all business rows, balances and issue counts remain identical.
  const expectedDiagnostic={schema_version:expected.diagnostic?.schema_version,
    source_scope:expected.diagnostic?.source_scope,status:expected.diagnostic?.status,
    totals:expected.diagnostic?.totals,issue_counts:expected.diagnostic?.issue_counts};
  const actualDiagnostic={schema_version:actual.diagnostic?.schema_version,
    source_scope:actual.diagnostic?.source_scope,status:actual.diagnostic?.status,
    totals:actual.diagnostic?.totals,issue_counts:actual.diagnostic?.issue_counts};
  if (JSON.stringify(actual.migration_versions)!==JSON.stringify(versions) || actual.engine_exists!==true
      || JSON.stringify(actual.counts)!==JSON.stringify(expected.counts)
      || JSON.stringify(actual.signatures)!==JSON.stringify(expected.signatures)
      || JSON.stringify(actualDiagnostic)!==JSON.stringify(expectedDiagnostic)
      || !/^[a-f0-9]{32}$/.test(actual.diagnostic?.fingerprint??"")
      || actual.diagnostic.fingerprint===expected.diagnostic.fingerprint) {
    throw new Error("تغيرت بيانات الأعمال أو التشخيص بعد الترحيلات؛ أوقف نشر الواجهة");
  }
  const report=join(dir,"report.json");
  writeFileSync(report,`${JSON.stringify({
    result:"STAGING_ATOMIC_POSTAPPLY_OK",createdAt:new Date().toISOString(),
    migrations:versions,operationCount:0,businessBaselineUnchanged:true,
    diagnosticTotalsUnchanged:true,
    diagnosticFingerprintChangedByOperationScope:true,
    previousDiagnosticFingerprint:expected.diagnostic.fingerprint,
    currentDiagnosticFingerprint:actual.diagnostic.fingerprint,
    productionModified:false,
    schema,sourceHashes:Object.fromEntries(versions.map((version)=>{
      const file=version==="20260924100000"?"20260924100000_inventory_atomic_variance_engine.sql"
        :version==="20260924101000"?"20260924101000_inventory_atomic_variance_hardening.sql"
        :version==="20260924102000"?"20260924102000_inventory_atomic_variance_zero_balance_guard.sql"
        :version==="20260924103000"?"20260924103000_inventory_atomic_variance_write_guard.sql"
        :"20260924104000_inventory_atomic_variance_diagnostic_compat.sql";
      return [file,hash(join(repo,"supabase/migrations",file))];
    })),
  },null,2)}\n`,{mode:0o600});
  console.log("نجح التحقق بعد تطبيق الترحيلات على Staging: المخطط والصلاحيات والبيانات والتشخيص سليمة");
  console.log(`REPORT_DIR=${dir}`);
}

if (process.argv[1]===fileURLToPath(import.meta.url)) {
  try { main(); } catch(error) { console.error(error.message); process.exitCode=1; }
}
