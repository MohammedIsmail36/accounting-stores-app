// Transactional Staging rehearsal for the protected output-tax account and explicit rollback.
import {
  chmodSync,
  chownSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  baselineSql,
  extractNamedPayload,
  validateBaseline,
} from "./backup-inventory-output-tax-system-account-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const cli = "supabase@2.116.0";
const baselinePath = "/backups/staging/inventory-output-tax-before-20260923-101332/baseline/baseline.json";
const migrationPath = join(root, "supabase/migrations/20260923130000_inventory_output_tax_system_account.sql");
const rollbackPath = join(root, "supabase/rollback/20260923130000_inventory_output_tax_system_account.sql");

function assertStagingLink() {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفضت التجربة: المشروع المرتبط ليس Staging المعتمد");
  }
}

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") throw new Error("شغّل التجربة بواسطة sudo من حساب deploy فقط");
    const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
    if (!token) throw new Error("جلسة Supabase للمستخدم deploy غير موجودة");
    return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: token };
  }
  return process.env;
}

function returnOutputToCaller(path) {
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  if (Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) chownSync(path, uid, gid);
}

function runQuery(sql, label, outputDir) {
  const queryPath = join(outputDir, `${label}.sql`);
  const logPath = join(outputDir, "run.log");
  writeFileSync(queryPath, sql, { mode: 0o600 });
  const result = spawnSync("npx", ["-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", queryPath], {
    cwd: root,
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    writeFileSync(logPath, `${label}\n${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\n`, { mode: 0o600 });
    throw new Error(`فشلت تجربة 2104 على Staging (${label})؛ التشخيص: ${logPath}`);
  }
  return result.stdout;
}

export function assertBaselineMatches(expected, actual, phase) {
  validateBaseline(actual);
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    }
    return value;
  };
  const stableDiagnostic = (value) => ({
    schema_version: value?.schema_version,
    source_scope: value?.source_scope,
    fingerprint: value?.fingerprint,
    status: value?.status,
    totals: value?.totals,
    issue_counts: value?.issue_counts,
  });
  for (const key of ["counts", "signatures", "tax_settings", "tax_accounts", "migration_state"]) {
    if (JSON.stringify(canonical(actual?.[key])) !== JSON.stringify(canonical(expected?.[key]))) {
      throw new Error(`تغير خط أساس Staging في ${phase}: ${key}`);
    }
  }
  if (JSON.stringify(canonical(stableDiagnostic(actual?.diagnostic)))
      !== JSON.stringify(canonical(stableDiagnostic(expected?.diagnostic)))) {
    throw new Error(`تغير خط أساس Staging في ${phase}: diagnostic`);
  }
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildRehearsalSql(migration, expected) {
  const settings = expected.tax_settings;
  return `BEGIN;
DO $identity$
BEGIN
  IF current_database() <> 'postgres'
     OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923130000') THEN
    RAISE EXCEPTION 'STAGING_OUTPUT_TAX_REHEARSAL_IDENTITY_MISMATCH';
  END IF;
END;
$identity$;

CREATE TEMP TABLE output_tax_settings_before ON COMMIT DROP AS
SELECT s.id, s.enable_tax, s.tax_rate,
       p.code AS purchase_code, v.code AS sales_code
FROM public.company_settings s
LEFT JOIN public.accounts p ON p.id = s.purchase_tax_account_id
LEFT JOIN public.accounts v ON v.id = s.sales_tax_account_id;

${migration}

DO $verify$
DECLARE v_sales_tax uuid;
BEGIN
  SELECT id INTO STRICT v_sales_tax
  FROM public.accounts
  WHERE code = '2104' AND name = 'ضريبة القيمة المضافة للمخرجات'
    AND account_type = 'liability' AND is_system IS TRUE
    AND is_active IS TRUE AND is_parent IS FALSE
    AND description = 'SYSTEM:OUTPUT_VAT:20260923130000';

  IF NOT EXISTS (
    SELECT 1 FROM public.accounts a JOIN public.accounts p ON p.id = a.parent_id
    WHERE a.id = v_sales_tax AND p.code = '2'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.accounts
    WHERE code = '2102' AND name = 'قروض قصيرة الأجل'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.accounts
    WHERE code = '2103' AND name = 'قروض طويلة الأجل'
  ) THEN
    RAISE EXCEPTION 'STAGING_OUTPUT_TAX_ACCOUNT_IDENTITY_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.company_settings s
    JOIN public.accounts p ON p.id = s.purchase_tax_account_id
    JOIN public.accounts v ON v.id = s.sales_tax_account_id
    WHERE p.code <> '1105' OR v.code <> '2104'
      OR s.enable_tax IS DISTINCT FROM ${settings.enable_tax ? "true" : "false"}
      OR s.tax_rate IS DISTINCT FROM ${Number(settings.tax_rate)}::numeric
  ) THEN
    RAISE EXCEPTION 'STAGING_OUTPUT_TAX_DEFAULT_MAPPING_INVALID';
  END IF;

  IF EXISTS (SELECT 1 FROM public.journal_entry_lines WHERE account_id = v_sales_tax)
     OR EXISTS (SELECT 1 FROM public.accounts WHERE parent_id = v_sales_tax)
     OR EXISTS (SELECT 1 FROM public.expense_types WHERE account_id = v_sales_tax) THEN
    RAISE EXCEPTION 'STAGING_OUTPUT_TAX_ACCOUNT_UNEXPECTED_USAGE';
  END IF;

  BEGIN
    DELETE FROM public.accounts WHERE id = v_sales_tax;
    RAISE EXCEPTION 'STAGING_OUTPUT_TAX_DELETE_ALLOWED';
  EXCEPTION WHEN check_violation OR raise_exception THEN
    IF SQLERRM NOT LIKE '%TAX_ACCOUNT_MAPPING_INVALID%'
       AND SQLERRM NOT LIKE '%SYSTEM_ACCOUNT_DELETE_FORBIDDEN%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.accounts SET code = '2199' WHERE id = v_sales_tax;
    RAISE EXCEPTION 'STAGING_OUTPUT_TAX_IDENTITY_UPDATE_ALLOWED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%لا يمكن تعديل رمز أو نوع أو موقع أو طبيعة حساب النظام%' THEN RAISE; END IF;
  END;
END;
$verify$;

${migration}

DO $idempotence$
BEGIN
  IF (SELECT count(*) FROM public.accounts WHERE code = '2104') <> 1
     OR (SELECT count(*) FROM public.company_settings
         WHERE purchase_tax_account_id = (SELECT id FROM public.accounts WHERE code = '1105')
           AND sales_tax_account_id = (SELECT id FROM public.accounts WHERE code = '2104')) <> 1 THEN
    RAISE EXCEPTION 'STAGING_OUTPUT_TAX_IDEMPOTENCE_FAILED';
  END IF;
END;
$idempotence$;

SELECT jsonb_build_object(
  'result', 'STAGING_OUTPUT_TAX_TRANSACTIONAL_REHEARSAL_OK',
  'settings_id', ${sqlLiteral(settings.id)},
  'enable_tax', ${settings.enable_tax ? "true" : "false"},
  'tax_rate', ${Number(settings.tax_rate)},
  'output_tax_code', '2104'
) AS rehearsal_result;
ROLLBACK;
`;
}

export function buildRollbackSql(migration, rollback) {
  return `BEGIN;
DO $identity$
BEGIN
  IF current_database() <> 'postgres'
     OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923130000') THEN
    RAISE EXCEPTION 'STAGING_OUTPUT_TAX_ROLLBACK_REHEARSAL_IDENTITY_MISMATCH';
  END IF;
END;
$identity$;

${migration}
SELECT set_config(
  'app.inventory_output_tax_account_rollback_authorized',
  'STAGING_20260923130000', true
);
${rollback}

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.accounts WHERE code = '2104')
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE code = '2102' AND name = 'قروض قصيرة الأجل')
     OR EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.accounts'::regclass
         AND tgname = 'trg_guard_system_accounts_delete'
         AND tgenabled = 'D'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'STAGING_OUTPUT_TAX_EXPLICIT_ROLLBACK_INVALID';
  END IF;
END;
$verify$;

SELECT jsonb_build_object(
  'result', 'STAGING_OUTPUT_TAX_EXPLICIT_ROLLBACK_REHEARSAL_OK'
) AS rollback_result;
ROLLBACK;
`;
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStagingLink();
  process.umask(0o077);
  const outputDir = mkdtempSync("/tmp/accounting-staging-output-tax-rehearsal-");
  chmodSync(outputDir, 0o700);

  try {
    const expected = JSON.parse(readFileSync(baselinePath, "utf8"));
    validateBaseline(expected);
    const before = extractNamedPayload(runQuery(baselineSql, "baseline-before", outputDir), "output_tax_baseline");
    assertBaselineMatches(expected, before, "قبل التجربة");

    const migration = readFileSync(migrationPath, "utf8");
    const rollback = readFileSync(rollbackPath, "utf8");
    const rehearsalOutput = runQuery(buildRehearsalSql(migration, expected), "rehearsal", outputDir);
    if (!rehearsalOutput.includes("STAGING_OUTPUT_TAX_TRANSACTIONAL_REHEARSAL_OK")) {
      throw new Error("علامة نجاح تجربة 2104 غير موجودة");
    }
    const afterRehearsal = extractNamedPayload(runQuery(baselineSql, "baseline-after-rehearsal", outputDir), "output_tax_baseline");
    assertBaselineMatches(expected, afterRehearsal, "بعد ROLLBACK التجربة");

    const rollbackOutput = runQuery(buildRollbackSql(migration, rollback), "explicit-rollback", outputDir);
    if (!rollbackOutput.includes("STAGING_OUTPUT_TAX_EXPLICIT_ROLLBACK_REHEARSAL_OK")) {
      throw new Error("علامة نجاح ملف الرجوع غير موجودة");
    }
    const afterRollback = extractNamedPayload(runQuery(baselineSql, "baseline-after-rollback", outputDir), "output_tax_baseline");
    assertBaselineMatches(expected, afterRollback, "بعد تجربة ملف الرجوع");

    const reportPath = join(outputDir, "report.json");
    writeFileSync(reportPath, `${JSON.stringify({
      result: "STAGING_INVENTORY_OUTPUT_TAX_REHEARSAL_OK",
      projectRef: expectedProjectRef,
      transactionRolledBack: true,
      explicitRollbackVerified: true,
      idempotenceVerified: true,
      accountProtectionVerified: true,
      legacyLoanAccountsPreserved: true,
      taxEnablementAndRatePreserved: true,
      baselineRestored: true,
      productionModified: false,
      generatedAt: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 });

    for (const path of [outputDir, ...["baseline-before.sql", "rehearsal.sql", "baseline-after-rehearsal.sql", "explicit-rollback.sql", "baseline-after-rollback.sql", "report.json"].map((name) => join(outputDir, name))]) {
      returnOutputToCaller(path);
    }
    console.log("نجحت تجربة حساب 2104 والربط الافتراضي على Staging داخل معاملات انتهت بـ ROLLBACK كامل");
    console.log("نجح التكرار والحماية وملف الرجوع، وعاد الحساب والإعدادات وبيانات الأعمال والتشخيص إلى خط الأساس");
    console.log("لم تُطبق Migration ولم تتغير أي بيئة إنتاجية");
    console.log(`REPORT_DIR=${outputDir}`);
  } catch (error) {
    for (const path of [outputDir, join(outputDir, "run.log")]) {
      try { returnOutputToCaller(path); } catch { /* best effort */ }
    }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
