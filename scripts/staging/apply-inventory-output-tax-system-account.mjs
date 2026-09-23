// Permanently apply the protected output-VAT account to linked Staging only.
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateOutputTaxMigrationSql,
  validateOutputTaxRollbackSql,
} from "../tests/rehearse-inventory-output-tax-system-account.mjs";
import {
  baselineSql,
  extractNamedPayload,
  validateBaseline,
} from "./backup-inventory-output-tax-system-account-baseline.mjs";
import { assertBaselineMatches } from "./rehearse-inventory-output-tax-system-account.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const archiveRoot = "/backups/staging/inventory-output-tax-before-20260923-101332";
const baselineArchive = join(archiveRoot, "baseline");
const rehearsalArchive = join(archiveRoot, "transactional-rehearsal");
const migrationVersion = "20260923130000";
const migrationFilename = `${migrationVersion}_inventory_output_tax_system_account.sql`;
const migrationPath = join(root, "supabase/migrations", migrationFilename);
const rollbackPath = join(root, "supabase/rollback", migrationFilename);
const cli = "supabase@2.116.0";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function stableDiagnostic(value) {
  return {
    schema_version: value?.schema_version,
    source_scope: value?.source_scope,
    fingerprint: value?.fingerprint,
    status: value?.status,
    totals: value?.totals,
    issue_counts: value?.issue_counts,
  };
}

function same(valueA, valueB) {
  return JSON.stringify(canonical(valueA)) === JSON.stringify(canonical(valueB));
}

export function validatePostApplyBusiness(before, after) {
  const expectedCounts = { ...before.counts, accounts: Number(before.counts.accounts) + 1 };
  const unchangedSignatures = Object.fromEntries(Object.entries(before.signatures)
    .filter(([key]) => !["accounts", "company_settings"].includes(key)));
  const actualUnchangedSignatures = Object.fromEntries(Object.entries(after.signatures)
    .filter(([key]) => !["accounts", "company_settings"].includes(key)));
  const beforeAccounts = before.tax_accounts.filter((account) => account.code !== "2104");
  const afterAccounts = after.tax_accounts.filter((account) => account.code !== "2104");
  const outputTax = after.tax_accounts.find((account) => account.code === "2104");
  const inputTax = after.tax_accounts.find((account) => account.code === "1105");
  const settings = after.tax_settings;

  if (!same(after.counts, expectedCounts)
      || !same(actualUnchangedSignatures, unchangedSignatures)
      || !same(afterAccounts, beforeAccounts)
      || !same(stableDiagnostic(after.diagnostic), stableDiagnostic(before.diagnostic))
      || !after.migration_state?.configurable_tax
      || !after.migration_state?.output_tax_account
      || after.settings_count !== 1
      || settings?.id !== before.tax_settings?.id
      || settings?.enable_tax !== before.tax_settings?.enable_tax
      || Number(settings?.tax_rate) !== Number(before.tax_settings?.tax_rate)
      || settings?.purchase_tax_account_id !== inputTax?.id
      || settings?.sales_tax_account_id !== outputTax?.id
      || !outputTax
      || outputTax.name !== "ضريبة القيمة المضافة للمخرجات"
      || outputTax.type !== "liability"
      || outputTax.parent_code !== "2"
      || outputTax.active !== true
      || outputTax.parent !== false
      || outputTax.system !== true
      || Number(outputTax.journal_lines) !== 0) {
    throw new Error("بيانات الأعمال أو الربط الافتراضي بعد التطبيق غير مطابقة");
  }
}

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") throw new Error("شغّل التطبيق بواسطة sudo من حساب deploy فقط");
    const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
    if (!token) throw new Error("جلسة Supabase للمستخدم deploy غير موجودة");
    return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: token };
  }
  return process.env;
}

function assertStagingLink() {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التطبيق: المشروع المرتبط ليس Staging المعتمد");
  }
}

function runCli(args, logPath, label) {
  assertStagingLink();
  const result = spawnSync("npx", ["-y", cli, ...args], {
    cwd: root,
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 420000,
    maxBuffer: 96 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  appendFileSync(logPath, `\n=== ${label} ===\n${output}\n`, { mode: 0o600 });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    throw new Error(`فشل تطبيق حساب 2104 على Staging (${label})؛ التشخيص: ${logPath}`);
  }
  return { stdout: result.stdout ?? "", combined: output };
}

function runQuery(sql, reportDir, logPath, label, payload) {
  const path = join(reportDir, `${label}.sql`);
  writeFileSync(path, sql, { mode: 0o600 });
  const output = runCli(
    ["db", "query", "--linked", "--output-format", "json", "--file", path], logPath, label);
  return extractNamedPayload(output.stdout, payload);
}

export const outputTaxVerificationSql = `BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
  'database', current_database(),
  'project_ref', '${expectedProjectRef}',
  'migration_present', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${migrationVersion}'
  ),
  'output_tax', (
    SELECT jsonb_build_object(
      'code', a.code, 'name', a.name, 'type', a.account_type,
      'active', a.is_active, 'parent', a.is_parent, 'system', a.is_system,
      'description', a.description, 'parent_code', p.code,
      'journal_lines', (SELECT count(*) FROM public.journal_entry_lines l WHERE l.account_id = a.id),
      'children', (SELECT count(*) FROM public.accounts c WHERE c.parent_id = a.id),
      'expense_types', (SELECT count(*) FROM public.expense_types e WHERE e.account_id = a.id)
    )
    FROM public.accounts a JOIN public.accounts p ON p.id = a.parent_id
    WHERE a.code = '2104'
  ),
  'loan_accounts', (
    SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name) ORDER BY code)
    FROM public.accounts WHERE code IN ('2102', '2103')
  ),
  'guards', jsonb_build_object(
    'system_delete_function', to_regprocedure('public.fn_guard_system_accounts_delete()') IS NOT NULL,
    'configured_shape_function', to_regprocedure('public.fn_guard_configured_tax_account_shape()') IS NOT NULL,
    'system_delete_trigger', (SELECT count(*) FROM pg_trigger
      WHERE tgrelid = 'public.accounts'::regclass
        AND tgname = 'trg_guard_system_accounts_delete' AND tgenabled <> 'D' AND NOT tgisinternal),
    'configured_shape_trigger', (SELECT count(*) FROM pg_trigger
      WHERE tgrelid = 'public.accounts'::regclass
        AND tgname = 'trg_guard_configured_tax_account_shape' AND tgenabled <> 'D' AND NOT tgisinternal)
  ),
  'comments', jsonb_build_object(
    'purchase', col_description('public.company_settings'::regclass,
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.company_settings'::regclass
        AND attname = 'purchase_tax_account_id' AND NOT attisdropped)),
    'sales', col_description('public.company_settings'::regclass,
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.company_settings'::regclass
        AND attname = 'sales_tax_account_id' AND NOT attisdropped))
  )
) AS output_tax_state;
ROLLBACK;
`;

export function validateOutputTaxState(state) {
  const account = state?.output_tax;
  const guards = state?.guards ?? {};
  const loans = state?.loan_accounts ?? [];
  if (state?.database !== "postgres"
      || state?.project_ref !== expectedProjectRef
      || !state?.migration_present
      || account?.code !== "2104"
      || account?.name !== "ضريبة القيمة المضافة للمخرجات"
      || account?.type !== "liability"
      || account?.parent_code !== "2"
      || account?.active !== true || account?.parent !== false || account?.system !== true
      || account?.description !== "SYSTEM:OUTPUT_VAT:20260923130000"
      || Number(account?.journal_lines) !== 0
      || Number(account?.children) !== 0
      || Number(account?.expense_types) !== 0
      || !same(loans, [
        { code: "2102", name: "قروض قصيرة الأجل" },
        { code: "2103", name: "قروض طويلة الأجل" },
      ])
      || !guards.system_delete_function || !guards.configured_shape_function
      || guards.system_delete_trigger !== 1 || guards.configured_shape_trigger !== 1
      || !state?.comments?.purchase?.includes("1105")
      || !state?.comments?.sales?.includes("2104")) {
    throw new Error("تعريف الحساب 2104 أو حمايته بعد التطبيق غير مطابق");
  }
}

export function validateApplySource(source) {
  for (const required of [
    expectedProjectRef, archiveRoot, migrationVersion, "--dry-run", "--yes",
    "assertBaselineMatches", "validatePostApplyBusiness", "validateOutputTaxState",
    "STAGING_INVENTORY_OUTPUT_TAX_APPLY_OK",
  ]) {
    if (!source.includes(required)) throw new Error(`حاجز مفقود من تطبيق 2104: ${required}`);
  }
  for (const forbidden of [/(?:farida|alibea)-db/i, /https?:\/\//i, /supabase\s+db\s+reset/i]) {
    if (forbidden.test(source)) throw new Error(`وجهة أو أمر ممنوع في تطبيق 2104: ${forbidden}`);
  }
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  validateApplySource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  assertStagingLink();

  const baselinePath = join(baselineArchive, "baseline.json");
  const manifestPath = join(baselineArchive, "manifest.json");
  const rehearsalPath = join(rehearsalArchive, "result/report.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const rehearsal = JSON.parse(readFileSync(rehearsalPath, "utf8"));
  validateBaseline(baseline);
  if (manifest.result !== "STAGING_INVENTORY_OUTPUT_TAX_BASELINE_OK"
      || manifest.files?.["baseline.json"]?.sha256 !== sha256(baselinePath)
      || rehearsal.result !== "STAGING_INVENTORY_OUTPUT_TAX_REHEARSAL_OK"
      || !rehearsal.transactionRolledBack
      || !rehearsal.explicitRollbackVerified
      || !rehearsal.idempotenceVerified
      || !rehearsal.baselineRestored) {
    throw new Error("نسخة Staging أو دليل تجربة 2104 غير صالحين");
  }

  validateOutputTaxMigrationSql(readFileSync(migrationPath, "utf8"));
  validateOutputTaxRollbackSql(readFileSync(rollbackPath, "utf8"));

  const reportDir = mkdtempSync("/tmp/accounting-staging-output-tax-apply-");
  const logPath = join(reportDir, "run.log");
  const before = runQuery(baselineSql, reportDir, logPath,
    "pre-apply-verification", "output_tax_baseline");
  assertBaselineMatches(baseline, before, "قبل التطبيق");

  const dryRun = runCli(["db", "push", "--linked", "--dry-run"], logPath, "migration-dry-run").combined;
  const migrationNames = [...new Set(
    [...dryRun.matchAll(/\b(\d{14}_[A-Za-z0-9_]+\.sql)\b/g)].map((match) => match[1]),
  )];
  if (migrationNames.length !== 1 || migrationNames[0] !== migrationFilename) {
    throw new Error(`الفحص الجاف لا يحتوي Migration 2104 وحدها؛ أُلغي التطبيق: ${logPath}`);
  }

  runCli(["db", "push", "--linked", "--yes"], logPath, "migration-apply");

  const after = runQuery(baselineSql, reportDir, logPath,
    "post-apply-business-verification", "output_tax_baseline");
  const state = runQuery(outputTaxVerificationSql, reportDir, logPath,
    "post-apply-schema-verification", "output_tax_state");
  validatePostApplyBusiness(before, after);
  validateOutputTaxState(state);

  writeFileSync(join(reportDir, "report.json"), `${JSON.stringify({
    result: "STAGING_INVENTORY_OUTPUT_TAX_APPLY_OK",
    appliedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    migrationVersion,
    outputTaxAccount: "2104",
    inputTaxAccount: "1105",
    legacyLoanAccountsPreserved: true,
    taxEnablementAndRatePreserved: true,
    businessBaselinePreserved: true,
    diagnosticPreserved: true,
    accountProtectionVerified: true,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });

  console.log("تم تطبيق حساب ضريبة المخرجات 2104 على Staging والتحقق منه بنجاح");
  console.log("رُبط 1105/2104 افتراضيًا، وبقي تفعيل الضريبة ونسبتها دون تغيير، ولم تتغير بيانات الأعمال");
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
