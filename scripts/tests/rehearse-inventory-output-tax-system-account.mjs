// TDD and migration rehearsal for the protected output-tax account in isolated L3 only.
import { chownSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const contractPath = join(root, "supabase/tests/inventory_output_tax_system_account_contract.sql");
const migrationPath = join(root, "supabase/migrations/20260923130000_inventory_output_tax_system_account.sql");
const rollbackPath = join(root, "supabase/rollback/20260923130000_inventory_output_tax_system_account.sql");
const defaultsPath = join(root, "supabase/functions/_shared/system-defaults.ts");
const prerequisitePaths = [
  "supabase/migrations/20260913160000_inventory_reconciliation_diagnostic.sql",
  "supabase/migrations/20260913234500_inventory_reconciliation_repair_lifecycle.sql",
  "supabase/migrations/20260914190000_inventory_reconciliation_rebuild_product_card_executor.sql",
  "supabase/migrations/20260921213000_inventory_reconciliation_system_accounts.sql",
  "supabase/migrations/20260921220000_inventory_reconciliation_missing_journal_plan.sql",
  "supabase/migrations/20260921233000_inventory_reconciliation_missing_journal_executor.sql",
  "supabase/migrations/20260923100000_inventory_reconciliation_configurable_tax_accounts.sql",
].map((path) => join(root, path));
const redMarker = "TDD_INVENTORY_OUTPUT_TAX_SYSTEM_ACCOUNT_RED_OK";
const contractMarker = "INVENTORY_OUTPUT_TAX_SYSTEM_ACCOUNT_CONTRACT_OK";

const forbiddenSqlPatterns = [
  /\bCOMMIT\b/i,
  /\bTRUNCATE\b/i,
  /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
  /(?:farida|alibea)-db/i,
  /https?:\/\//i,
  /\\connect\b/i,
];

export function validateOutputTaxContractSql(sql) {
  for (const required of [
    "BEGIN;", "ROLLBACK;", "current_database() <> 'l3_public_restore'",
    "2104", "ضريبة القيمة المضافة للمخرجات", "2102", "قروض قصيرة الأجل",
    "SYSTEM_ACCOUNT_DELETE_FORBIDDEN", "pg_temp.output_tax_settings_before", contractMarker,
  ]) {
    if (!sql.includes(required)) throw new Error(`شرط مفقود من عقد حساب ضريبة المخرجات: ${required}`);
  }
  for (let index = 1; index <= 8; index += 1) {
    const label = `Scenario ${String(index).padStart(2, "0")}`;
    if (!sql.includes(label)) throw new Error(`سيناريو حساب ضريبة المخرجات مفقود: ${label}`);
  }
  for (const pattern of forbiddenSqlPatterns) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في عقد حساب ضريبة المخرجات: ${pattern}`);
  }
}
export function validateOutputTaxMigrationSql(sql) {
  for (const required of [
    "OUTPUT_TAX_SYSTEM_ACCOUNT_BASELINE_MISMATCH",
    "LEGACY_LOAN_ACCOUNT_2102_IDENTITY_CONFLICT",
    "SYSTEM:OUTPUT_VAT:20260923130000",
    "ضريبة القيمة المضافة للمخرجات",
    "purchase_tax_account_id = COALESCE",
    "sales_tax_account_id = COALESCE",
    "OUTPUT_TAX_MIGRATION_CHANGED_ENABLEMENT_OR_RATE",
  ]) {
    if (!sql.includes(required)) throw new Error(`جزء مفقود من Migration حساب ضريبة المخرجات: ${required}`);
  }
  for (const pattern of forbiddenSqlPatterns) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في Migration حساب ضريبة المخرجات: ${pattern}`);
  }
}

export function validateOutputTaxRollbackSql(sql) {
  for (const required of [
    "STAGING_20260923130000",
    "OUTPUT_TAX_SYSTEM_ACCOUNT_ROLLBACK_NOT_AUTHORIZED",
    "OUTPUT_TAX_SYSTEM_ACCOUNT_ROLLBACK_HAS_DEPENDENCIES",
    "DISABLE TRIGGER trg_guard_system_accounts_delete",
    "ENABLE TRIGGER trg_guard_system_accounts_delete",
    "SYSTEM:OUTPUT_VAT:20260923130000",
  ]) {
    if (!sql.includes(required)) throw new Error(`جزء مفقود من ملف رجوع حساب ضريبة المخرجات: ${required}`);
  }
  for (const pattern of [...forbiddenSqlPatterns, /\bCASCADE\b/i]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في ملف رجوع حساب ضريبة المخرجات: ${pattern}`);
  }
}

export function validateOutputTaxDefaultsSource(source) {
  if (!source.includes('"2104"')
      || !source.includes('code: "2104"')
      || !source.includes('name: "ضريبة القيمة المضافة للمخرجات"')
      || !source.includes('"1105"')) {
    throw new Error("الحسابان الافتراضيان 1105/2104 غير مكتملين في مصدر التهيئة");
  }
}

function runDocker(args, input) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 48 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(result.stderr?.trim() || result.error?.message || "فشل فحص L3");
  }
  return result.stdout.trim();
}

function psql(query) {
  return runDocker([
    "exec", "-i", container, "psql", "-h", "/tmp", "-U", "postgres",
    "-d", database, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-",
  ], query);
}

function returnOutputToCaller(path) {
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  if (Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) chownSync(path, uid, gid);
}

function writeFailure(prefix, error) {
  const reportDir = mkdtempSync(`/tmp/${prefix}-`);
  const logPath = join(reportDir, "run.log");
  writeFileSync(logPath, `${error.message}\n`, { mode: 0o600 });
  returnOutputToCaller(reportDir);
  returnOutputToCaller(logPath);
  return logPath;
}

const businessStateSql = `SELECT jsonb_build_object(
  'accounts', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(a)::text, '|' ORDER BY a.id), ''))) FROM public.accounts a),
  'company_settings', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), ''))) FROM public.company_settings s),
  'journal_entries', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id), ''))) FROM public.journal_entries j),
  'journal_entry_lines', (SELECT jsonb_build_object('count', count(*), 'signature',
    md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), ''))) FROM public.journal_entry_lines l)
);`;

function prerequisiteSql() {
  return prerequisitePaths.map((path) => readFileSync(path, "utf8")).join("\n");
}

function settingsSnapshotSql() {
  return `CREATE TEMP TABLE output_tax_settings_before ON COMMIT DROP AS
SELECT s.id, s.enable_tax, s.tax_rate,
       p.code AS purchase_code, v.code AS sales_code
FROM public.company_settings s
LEFT JOIN public.accounts p ON p.id = s.purchase_tax_account_id
LEFT JOIN public.accounts v ON v.id = s.sales_tax_account_id;`;
}

function main() {
  const mode = process.argv[2] ?? "--check";
  const allowed = ["--check", "--expect-missing", "--run-migration", "--test-explicit-rollback", "--run-all"];
  if (!allowed.includes(mode) || process.argv.length > 3) throw new Error(`استخدم ${allowed.join(" أو ")}`);

  const contract = readFileSync(contractPath, "utf8");
  validateOutputTaxContractSql(contract);
  validateOutputTaxDefaultsSource(readFileSync(defaultsPath, "utf8"));
  const migrationExists = existsSync(migrationPath);
  const rollbackExists = existsSync(rollbackPath);

  if (mode === "--check") {
    if (migrationExists !== rollbackExists) throw new Error("يجب وجود Migration حساب ضريبة المخرجات وملف رجوعها معًا");
    if (migrationExists) {
      validateOutputTaxMigrationSql(readFileSync(migrationPath, "utf8"));
      validateOutputTaxRollbackSql(readFileSync(rollbackPath, "utf8"));
    }
    console.log(`تم التحقق من عقد حساب ضريبة المخرجات؛ Migration ${migrationExists ? "موجودة" : "غير موجودة"}`);
    return;
  }

  assertIsolation(JSON.parse(runDocker(["inspect", container]))[0]);
  const before = psql(businessStateSql);

  if (mode === "--expect-missing") {
    if (migrationExists || rollbackExists) throw new Error("ملفات التنفيذ موجودة؛ لم تعد مرحلة TDD الحمراء صالحة");
    const output = psql(`\\set ON_ERROR_STOP on
BEGIN;
DO $red$
BEGIN
  IF EXISTS (SELECT 1 FROM public.accounts WHERE code = '2104') THEN
    RAISE EXCEPTION 'OUTPUT_TAX_ACCOUNT_UNEXPECTEDLY_EXISTS';
  END IF;
END;
$red$;
SELECT '${redMarker}';
ROLLBACK;`);
    const after = psql(businessStateSql);
    if (!output.includes(redMarker) || before !== after) throw new Error("فشل إثبات TDD الأحمر أو تغيرت بيانات L3");
    console.log(`${redMarker}: العقد جاهز وحساب 2104 وملفات تنفيذه غير موجودة كما هو متوقع`);
    console.log("لم يُنشأ أو يُعدّل أي حساب، ولم تتغير L3 أو Staging أو أي قاعدة إنتاجية");
    return;
  }

  if (!migrationExists || !rollbackExists) throw new Error("Migration حساب ضريبة المخرجات أو ملف رجوعها غير موجود");
  const migration = readFileSync(migrationPath, "utf8");
  const rollback = readFileSync(rollbackPath, "utf8");
  validateOutputTaxMigrationSql(migration);
  validateOutputTaxRollbackSql(rollback);

  let migrationVerified = false;
  if (mode === "--run-migration" || mode === "--run-all") {
    let output;
    try {
      output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${prerequisiteSql()}
${settingsSnapshotSql()}
${migration}
${contract}`);
    } catch (error) {
      const logPath = writeFailure("accounting-inventory-output-tax-account-report", error);
      throw new Error(`فشل اختبار Migration حساب ضريبة المخرجات؛ التشخيص المحمي: ${logPath}`);
    }
    const after = psql(businessStateSql);
    if (!output.includes(contractMarker) || before !== after) {
      throw new Error("فشل عقد حساب ضريبة المخرجات أو لم تعد L3 إلى خط الأساس");
    }
    migrationVerified = true;
    console.log("نجحت Migration حساب ضريبة المخرجات المحمي في السيناريوهات الثمانية داخل L3 المعزولة");
    console.log("تم الرجوع عن الحساب والربط الافتراضي والعينات بالكامل؛ لم تتغير L3 أو Staging أو الإنتاج");
    if (mode === "--run-migration") return;
  }

  let output;
  try {
    output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${prerequisiteSql()}
${settingsSnapshotSql()}
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
       SELECT 1 FROM public.company_settings s
       JOIN public.accounts a ON a.id = s.sales_tax_account_id
       WHERE a.code = '2104'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.accounts'::regclass
         AND tgname = 'trg_guard_system_accounts_delete'
         AND tgenabled <> 'D' AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'OUTPUT_TAX_EXPLICIT_ROLLBACK_INVALID';
  END IF;
END;
$verify$;
SELECT 'INVENTORY_OUTPUT_TAX_SYSTEM_ACCOUNT_EXPLICIT_ROLLBACK_OK';
ROLLBACK;`);
  } catch (error) {
    const logPath = writeFailure("accounting-inventory-output-tax-account-rollback-report", error);
    throw new Error(`فشل اختبار ملف رجوع حساب ضريبة المخرجات؛ التشخيص المحمي: ${logPath}`);
  }
  const after = psql(businessStateSql);
  if (!output.includes("INVENTORY_OUTPUT_TAX_SYSTEM_ACCOUNT_EXPLICIT_ROLLBACK_OK") || before !== after) {
    throw new Error("فشل ملف الرجوع الصريح أو لم تعد L3 إلى خط الأساس");
  }
  console.log("نجح اختبار ملف رجوع حساب ضريبة المخرجات داخل L3 المعزولة");
  console.log("أزيل 2104 وربطه الافتراضي، وبقي 2102 حساب قروض؛ لم تتغير Staging أو الإنتاج");

  if (mode === "--run-all") {
    const reportDir = mkdtempSync("/tmp/accounting-inventory-output-tax-account-report-");
    const reportPath = join(reportDir, "report.json");
    writeFileSync(reportPath, `${JSON.stringify({
      result: "INVENTORY_OUTPUT_TAX_SYSTEM_ACCOUNT_L3_OK",
      database,
      container,
      isolated: true,
      scenarios: 8,
      migrationVerified,
      explicitRollbackVerified: true,
      businessStateRestored: true,
      hostedEnvironmentModified: false,
      generatedAt: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 });
    returnOutputToCaller(reportDir);
    returnOutputToCaller(reportPath);
    console.log(`REPORT_DIR=${reportDir}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
