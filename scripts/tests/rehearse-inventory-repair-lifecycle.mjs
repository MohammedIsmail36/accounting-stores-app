// TDD لدورة سجل معالجة انحرافات المخزون داخل حاوية L3 المعزولة فقط.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";
import { validateDiagnosticMigrationSql } from "./rehearse-inventory-reconciliation-diagnostic.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sqlPath = join(root, "supabase/tests/inventory_reconciliation_repair_lifecycle_contract.sql");
const diagnosticMigrationPath = join(root, "supabase/migrations/20260913160000_inventory_reconciliation_diagnostic.sql");
const migrationPath = join(root, "supabase/migrations/20260913234500_inventory_reconciliation_repair_lifecycle.sql");
const marker = "INVENTORY_RECONCILIATION_REPAIR_LIFECYCLE_CONTRACT_OK";

export const requiredRepairTables = [
  "inventory_reconciliation_repairs",
  "inventory_reconciliation_repair_items",
  "inventory_reconciliation_repair_effects",
  "inventory_reconciliation_repair_events",
];

export const requiredRepairFunctions = [
  "public.create_inventory_reconciliation_repair(text,text,text,timestamptz,text,jsonb,uuid)",
  "public.update_inventory_reconciliation_repair(uuid,text,text,jsonb,integer,uuid)",
  "public.submit_inventory_reconciliation_repair(uuid,integer,uuid)",
  "public.approve_inventory_reconciliation_repair(uuid,integer,text,uuid)",
  "public.cancel_inventory_reconciliation_repair(uuid,text,integer,uuid)",
  "public.execute_inventory_reconciliation_repair(uuid,integer,uuid)",
];

export function validateRepairLifecycleContractSql(sql) {
  for (const required of [
    "BEGIN;",
    "ROLLBACK;",
    "current_database() <> 'l3_public_restore'",
    marker,
    ...requiredRepairTables,
    ...requiredRepairFunctions.map((signature) => signature.split("(")[0].replace("public.", "")),
  ]) {
    if (!sql.includes(required)) throw new Error(`حاجز أو عقد مفقود من اختبار المعالج: ${required}`);
  }
  for (let index = 1; index <= 16; index += 1) {
    const label = `Scenario ${String(index).padStart(2, "0")}`;
    if (!sql.includes(label)) throw new Error(`سيناريو معالج مفقود: ${label}`);
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /\bDELETE\s+FROM\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في اختبار دورة المعالج: ${pattern}`);
  }
}

export function validateRepairLifecycleMigrationSql(sql) {
  for (const required of [
    ...requiredRepairTables.map((name) => `CREATE TABLE public.${name}`),
    ...requiredRepairFunctions.map((signature) => `CREATE FUNCTION ${signature.split("(")[0]}(`),
    "SECURITY DEFINER",
    "ENABLE ROW LEVEL SECURITY",
    "REPAIR_DUPLICATE_ISSUE",
    "REPAIR_ISSUE_ACTIVE",
    "REPAIR_VERSION_CONFLICT",
    "REPAIR_TYPE_NOT_ENABLED",
    "pg_advisory_xact_lock",
  ]) {
    if (!sql.includes(required)) throw new Error(`جزء مفقود من Migration دورة المعالج: ${required}`);
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(?:products|inventory_movements|journal_entries|journal_entry_lines)\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في Migration دورة المعالج: ${pattern}`);
  }
}

function runDocker(args, input) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(result.stderr?.trim() || result.error?.message || "فشل فحص L3");
  }
  return result.stdout.trim();
}

function psql(query) {
  return runDocker(
    [
      "exec", "-i", container, "psql", "-h", "/tmp", "-U", "postgres",
      "-d", database, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-",
    ],
    query,
  );
}

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--expect-missing", "--run-migration"].includes(mode) || process.argv.length > 3) {
    throw new Error("استخدم --check أو --expect-missing أو --run-migration");
  }

  const sql = readFileSync(sqlPath, "utf8");
  const diagnosticMigration = readFileSync(diagnosticMigrationPath, "utf8");
  const migration = readFileSync(migrationPath, "utf8");
  validateRepairLifecycleContractSql(sql);
  validateDiagnosticMigrationSql(diagnosticMigration);
  validateRepairLifecycleMigrationSql(migration);
  if (mode === "--check") {
    console.log("تم التحقق من عقد دورة المعالج وMigration؛ لم يُنفذ SQL");
    return;
  }

  assertIsolation(JSON.parse(runDocker(["inspect", container]))[0]);
  const state = JSON.parse(
    psql(`SELECT jsonb_build_object(
      'tables', jsonb_build_object(
        ${requiredRepairTables.map((name) => `'${name}', to_regclass('public.${name}') IS NOT NULL`).join(",\n        ")}
      ),
      'functions', jsonb_build_object(
        ${requiredRepairFunctions.map((signature, index) => `'f${index + 1}', to_regprocedure('${signature}') IS NOT NULL`).join(",\n        ")}
      )
    );`),
  );
  const hasObjects = Object.values(state.tables).some(Boolean) || Object.values(state.functions).some(Boolean);
  if (hasObjects) {
    throw new Error("بعض جداول أو دوال المعالج موجودة بالفعل؛ لم تعد مرحلة TDD الحمراء صالحة");
  }

  if (mode === "--expect-missing") {
    console.log("TDD_REPAIR_LIFECYCLE_RED_OK: عقد الاختبار جاهز والجداول والدوال الجديدة غير موجودة كما هو متوقع");
    console.log("لم تُنفذ بيانات السيناريوهات ولم تتغير L3 أو Staging أو أي قاعدة إنتاجية");
    return;
  }

  const reportDir = mkdtempSync("/tmp/accounting-inventory-repair-lifecycle-report-");
  const logPath = join(reportDir, "run.log");
  const businessStateSql = `SELECT jsonb_build_object(
    'products', (SELECT jsonb_build_object('count', count(*), 'signature',
      md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), ''))) FROM public.products p),
    'inventory_movements', (SELECT jsonb_build_object('count', count(*), 'signature',
      md5(COALESCE(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id), ''))) FROM public.inventory_movements m),
    'sales_invoices', (SELECT jsonb_build_object('count', count(*), 'signature',
      md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), ''))) FROM public.sales_invoices s),
    'purchase_invoices', (SELECT jsonb_build_object('count', count(*), 'signature',
      md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), ''))) FROM public.purchase_invoices p),
    'journal_entries', (SELECT jsonb_build_object('count', count(*), 'signature',
      md5(COALESCE(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id), ''))) FROM public.journal_entries j),
    'journal_entry_lines', (SELECT jsonb_build_object('count', count(*), 'signature',
      md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), ''))) FROM public.journal_entry_lines l),
    'audit_log', (SELECT jsonb_build_object('count', count(*), 'signature',
      md5(COALESCE(string_agg(to_jsonb(a)::text, '|' ORDER BY a.id), ''))) FROM public.audit_log a)
  );`;
  const before = psql(businessStateSql);
  const contractBody = sql
    .replace(/^\\set ON_ERROR_STOP on\s*/m, "")
    .replace(/^BEGIN;\s*/m, "");
  let output;
  try {
    output = psql(`\\set ON_ERROR_STOP on\nBEGIN;\n${diagnosticMigration}\n${migration}\n${contractBody}`);
  } catch (error) {
    writeFileSync(logPath, `${error.message}\n`, { mode: 0o600 });
    throw new Error(`فشل اختبار Migration دورة المعالج؛ التشخيص المحمي: ${logPath}`);
  }
  const after = psql(businessStateSql);
  const remaining = JSON.parse(
    psql(`SELECT jsonb_build_object(
      'tables', jsonb_build_object(
        ${requiredRepairTables.map((name) => `'${name}', to_regclass('public.${name}') IS NOT NULL`).join(",\n        ")}
      ),
      'functions', jsonb_build_object(
        ${requiredRepairFunctions.map((signature, index) => `'f${index + 1}', to_regprocedure('${signature}') IS NOT NULL`).join(",\n        ")}
      )
    );`),
  );
  if (!output.includes(marker)) throw new Error("لم تظهر علامة نجاح عقد دورة المعالج");
  if (before !== after) throw new Error("تغيرت بيانات أعمال L3 بعد الاختبار رغم ROLLBACK");
  if (Object.values(remaining.tables).some(Boolean) || Object.values(remaining.functions).some(Boolean)) {
    throw new Error("بقيت مكونات معالج المخزون في L3 بعد ROLLBACK");
  }

  const reportPath = join(reportDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify({
    status: "INVENTORY_RECONCILIATION_REPAIR_LIFECYCLE_MIGRATION_OK",
    verifiedAt: new Date().toISOString(),
    container,
    database,
    migration: migrationPath,
    diagnosticDependency: diagnosticMigrationPath,
    scenarios: 16,
    migrationRolledBack: true,
    isolatedBusinessStatePreserved: true,
    productionOrHostedStagingModified: false,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجحت Migration ودورة المعالج في السيناريوهات الستة عشر داخل L3 المعزولة");
  console.log("تم الرجوع عن الجداول والدوال والعينات بالكامل؛ لم تتغير L3 أو Staging أو الإنتاج");
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
