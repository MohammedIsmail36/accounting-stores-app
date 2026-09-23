// Independent read-only verification after output-VAT account application on Staging.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  baselineSql,
  extractNamedPayload,
  validateBaseline,
} from "./backup-inventory-output-tax-system-account-baseline.mjs";
import {
  outputTaxVerificationSql,
  validateOutputTaxState,
  validatePostApplyBusiness,
} from "./apply-inventory-output-tax-system-account.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const baselineArchive = "/backups/staging/inventory-output-tax-before-20260923-101332/baseline";
const migrationVersion = "20260923130000";
const cli = "supabase@2.116.0";

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") throw new Error("شغّل التحقق بواسطة sudo من حساب deploy فقط");
    const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
    if (!token) throw new Error("جلسة Supabase للمستخدم deploy غير موجودة");
    return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: token };
  }
  return process.env;
}

function runQuery(sql, reportDir, logPath, name, payload) {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التحقق: المشروع المرتبط ليس Staging المعتمد");
  }
  const queryPath = join(reportDir, `${name}.sql`);
  writeFileSync(queryPath, sql, { mode: 0o600 });
  const result = spawnSync("npx", [
    "-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", queryPath,
  ], {
    cwd: root, env: cliEnvironment(), encoding: "utf8", timeout: 300000,
    maxBuffer: 96 * 1024 * 1024,
  });
  writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.stack ?? ""}\n`, { mode: 0o600 });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    throw new Error(`فشل التحقق المستقل من حساب 2104؛ التشخيص: ${logPath}`);
  }
  return extractNamedPayload(result.stdout, payload);
}

export function validateVerifierSource(source) {
  for (const required of [expectedProjectRef, baselineArchive, migrationVersion,
    "BEGIN TRANSACTION READ ONLY;", "validatePostApplyBusiness", "validateOutputTaxState",
    "STAGING_INVENTORY_OUTPUT_TAX_POST_APPLY_OK", "productionModified: false"]) {
    if (!source.includes(required)) throw new Error(`حاجز مفقود من تحقق 2104: ${required}`);
  }
  for (const forbidden of [/(?:farida|alibea)-db/i, /https?:\/\//i]) {
    if (forbidden.test(source)) throw new Error(`وجهة ممنوعة في تحقق 2104: ${forbidden}`);
  }
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا الفاحص لا يقبل معاملات");
  validateVerifierSource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  const baseline = JSON.parse(readFileSync(join(baselineArchive, "baseline.json"), "utf8"));
  validateBaseline(baseline);

  const reportDir = mkdtempSync("/tmp/accounting-staging-output-tax-postapply-");
  const logPath = join(reportDir, "run.log");
  const business = runQuery(baselineSql, reportDir, logPath,
    "business-verification", "output_tax_baseline");
  const state = runQuery(outputTaxVerificationSql, reportDir, logPath,
    "schema-verification", "output_tax_state");
  validatePostApplyBusiness(baseline, business);
  validateOutputTaxState(state);

  writeFileSync(join(reportDir, "report.json"), `${JSON.stringify({
    result: "STAGING_INVENTORY_OUTPUT_TAX_POST_APPLY_OK",
    verifiedAt: new Date().toISOString(), projectRef: expectedProjectRef, migrationVersion,
    account2104Verified: true, defaultMappingsVerified: true,
    taxEnablementAndRatePreserved: true, businessBaselinePreserved: true,
    accountProtectionVerified: true, legacyLoanAccountsPreserved: true,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });

  console.log("نجح التحقق الرسمي بعد تطبيق حساب ضريبة المخرجات 2104 على Staging");
  console.log("هوية الحساب وحمايته والربط 1105/2104 سليمة، وبيانات الأعمال وإعدادات تفعيل الضريبة مطابقة للنسخة");
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
