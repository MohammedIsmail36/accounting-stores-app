// يشغل عقد مطابقة المخزون داخل حاوية L3 المعزولة فقط؛ لا يتصل بأي قاعدة مستضافة.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertIsolation,
  container,
  database,
} from "./rehearse-public-restore.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sqlPath = join(root, "supabase/tests/inventory_reconciliation_baseline.sql");
const successMarker = "INVENTORY_RECONCILIATION_BASELINE_DB_TEST_OK";

export function validateInventoryReconciliationTestSql(sql) {
  const required = [
    "BEGIN;",
    "ROLLBACK;",
    "current_database() <> 'l3_public_restore'",
    successMarker,
  ];
  for (const value of required) {
    if (!sql.includes(value)) throw new Error(`عنصر حماية مفقود من اختبار المطابقة: ${value}`);
  }

  const forbidden = [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bUPDATE\s+public\./i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في اختبار المطابقة: ${pattern}`);
  }
}

const stateSql = `
SELECT jsonb_build_object(
  'products', (SELECT count(*) FROM public.products),
  'movements', (SELECT count(*) FROM public.inventory_movements),
  'journal_entries', (SELECT count(*) FROM public.journal_entries),
  'journal_lines', (SELECT count(*) FROM public.journal_entry_lines),
  'inventory_quantity', (SELECT COALESCE(sum(quantity), 0) FROM public.inventory_movements),
  'inventory_cost', (SELECT COALESCE(sum(total_cost), 0) FROM public.inventory_movements)
);
`;

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--run"].includes(mode) || process.argv.length > 3) {
    throw new Error("استخدم --check أو --run");
  }

  const sql = readFileSync(sqlPath, "utf8");
  validateInventoryReconciliationTestSql(sql);
  if (mode === "--check") {
    console.log("تم التحقق من حواجز اختبار مطابقة المخزون؛ لم يُنفذ SQL");
    return;
  }

  const reportDir = mkdtempSync("/tmp/accounting-inventory-reconciliation-report-");
  const logPath = join(reportDir, "run.log");
  const run = (args, input) => {
    const result = spawnSync("docker", args, {
      input,
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0 || result.error) {
      writeFileSync(
        logPath,
        `${result.stderr ?? ""}\n${result.error?.message ?? ""}`,
        { mode: 0o600 },
      );
      throw new Error(`فشل اختبار قاعدة البيانات؛ التشخيص المحمي: ${logPath}`);
    }
    return result.stdout;
  };

  const info = JSON.parse(run(["inspect", container]))[0];
  assertIsolation(info);
  const psql = (query) =>
    run(
      [
        "exec",
        "-i",
        container,
        "psql",
        "-h",
        "/tmp",
        "-U",
        "postgres",
        "-d",
        database,
        "-X",
        "-q",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        "-",
      ],
      query,
    ).trim();

  const before = psql(stateSql);
  const output = psql(sql);
  const after = psql(stateSql);
  if (!output.includes(successMarker)) {
    throw new Error("لم يُرجع اختبار قاعدة البيانات علامة النجاح المتوقعة");
  }
  if (after !== before) {
    throw new Error("تغير خط أساس قاعدة L3 المعزولة بعد الاختبار؛ النتيجة مرفوضة");
  }

  const report = {
    status: successMarker,
    verifiedAt: new Date().toISOString(),
    container,
    database,
    transactionRolledBack: true,
    isolatedStatePreserved: true,
    productionOrHostedStagingModified: false,
  };
  const reportPath = join(reportDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log("نجح اختبار قاعدة البيانات المعزول لمطابقة المخزون ولم تتغير بيانات L3");
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
