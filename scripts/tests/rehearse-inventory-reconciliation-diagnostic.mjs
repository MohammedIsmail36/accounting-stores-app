// TDD لعقد التشخيص الجديد داخل حاوية L3 المعزولة؛ لا يتصل بقواعد مستضافة.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sqlPath = join(root, "supabase/tests/inventory_reconciliation_diagnostic_contract.sql");
const signature = "public.get_inventory_reconciliation_diagnostic(text,boolean,text,integer,integer,text)";
const marker = "INVENTORY_RECONCILIATION_DIAGNOSTIC_CONTRACT_OK";

export function validateDiagnosticContractSql(sql) {
  for (const required of ["BEGIN;", "ROLLBACK;", "current_database() <> 'l3_public_restore'", marker]) {
    if (!sql.includes(required)) throw new Error(`حاجز مفقود من اختبار عقد التشخيص: ${required}`);
  }
  for (let index = 1; index <= 16; index += 1) {
    const label = `Scenario ${String(index).padStart(2, "0")}`;
    if (!sql.includes(label)) throw new Error(`سيناريو عقد مفقود: ${label}`);
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bUPDATE\s+public\./i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في اختبار العقد: ${pattern}`);
  }
}

const stateSql = `SELECT jsonb_build_object(
  'products', (SELECT count(*) FROM public.products),
  'movements', (SELECT count(*) FROM public.inventory_movements),
  'purchase_invoices', (SELECT count(*) FROM public.purchase_invoices),
  'sales_invoices', (SELECT count(*) FROM public.sales_invoices),
  'journal_entries', (SELECT count(*) FROM public.journal_entries),
  'journal_lines', (SELECT count(*) FROM public.journal_entry_lines),
  'audit_rows', (SELECT count(*) FROM public.audit_log)
);`;

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--expect-missing", "--run"].includes(mode) || process.argv.length > 3) {
    throw new Error("استخدم --check أو --expect-missing أو --run");
  }
  const sql = readFileSync(sqlPath, "utf8");
  validateDiagnosticContractSql(sql);
  if (mode === "--check") {
    console.log("تم التحقق من حواجز وسيناريوهات عقد التشخيص؛ لم يُنفذ SQL");
    return;
  }

  const reportDir = mkdtempSync("/tmp/accounting-inventory-diagnostic-report-");
  const logPath = join(reportDir, "run.log");
  const run = (args, input) => {
    const result = spawnSync("docker", args, {
      input,
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0 || result.error) {
      writeFileSync(logPath, `${result.stderr ?? ""}\n${result.error?.message ?? ""}`, { mode: 0o600 });
      throw new Error(`فشل اختبار عقد التشخيص؛ التشخيص المحمي: ${logPath}`);
    }
    return result.stdout.trim();
  };

  assertIsolation(JSON.parse(run(["inspect", container]))[0]);
  const psql = (query) => run([
    "exec", "-i", container, "psql", "-h", "/tmp", "-U", "postgres",
    "-d", database, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-",
  ], query);
  const exists = psql(`SELECT to_regprocedure('${signature}') IS NOT NULL;`) === "t";

  if (mode === "--expect-missing") {
    if (exists) throw new Error("الدالة موجودة بالفعل؛ لم تعد مرحلة TDD الحمراء صالحة");
    console.log("TDD_RED_OK: عقد الاختبار جاهز والدالة الجديدة غير موجودة كما هو متوقع");
    console.log("لم تُنفذ بيانات اختبار ولم تتغير قاعدة L3 أو أي قاعدة مستضافة");
    return;
  }
  if (!exists) throw new Error("الدالة الجديدة غير موجودة؛ نفذ Migration المعزولة قبل --run");

  const before = psql(stateSql);
  const output = psql(sql);
  const after = psql(stateSql);
  if (!output.includes(marker)) throw new Error("لم تظهر علامة نجاح عقد التشخيص");
  if (before !== after) throw new Error("تغيرت قاعدة L3 بعد الاختبار رغم ROLLBACK");

  const reportPath = join(reportDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify({
    status: marker,
    verifiedAt: new Date().toISOString(),
    container,
    database,
    scenarios: 16,
    transactionRolledBack: true,
    isolatedStatePreserved: true,
    productionOrHostedStagingModified: false,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجحت سيناريوهات عقد تشخيص مطابقة المخزون الستة عشر داخل L3 المعزولة");
  console.log(`التقرير: ${reportPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
