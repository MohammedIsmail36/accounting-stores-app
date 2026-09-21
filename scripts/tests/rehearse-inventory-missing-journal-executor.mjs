// TDD الأحمر لمنفذ 2D-B داخل حاوية L3 المعزولة فقط.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const contractPath = join(root,
  "supabase/tests/inventory_reconciliation_missing_journal_executor_contract.sql");
const diagnosticMigrationPath = join(root,
  "supabase/migrations/20260913160000_inventory_reconciliation_diagnostic.sql");
const lifecycleMigrationPath = join(root,
  "supabase/migrations/20260913234500_inventory_reconciliation_repair_lifecycle.sql");
const rebuildMigrationPath = join(root,
  "supabase/migrations/20260914190000_inventory_reconciliation_rebuild_product_card_executor.sql");
const plannerMigrationPath = join(root,
  "supabase/migrations/20260921220000_inventory_reconciliation_missing_journal_plan.sql");
const executorMigrationPath = join(root,
  "supabase/migrations/20260921233000_inventory_reconciliation_missing_journal_executor.sql");
const executorRollbackPath = join(root,
  "supabase/rollback/20260921233000_inventory_reconciliation_missing_journal_executor.sql");
const marker = "INVENTORY_RECONCILIATION_MISSING_JOURNAL_EXECUTOR_CONTRACT_OK";

export function validateExecutorContractSql(sql) {
  for (const required of [
    "BEGIN;", "ROLLBACK;", "current_database() <> 'l3_public_restore'", marker,
    "REPAIR_PRECONDITION_CHANGED", "missing_inventory_journal_created",
    "create_missing_inventory_journal", "NO_CORRECTION_REQUIRED",
  ]) {
    if (!sql.includes(required)) throw new Error(`حاجز أو شرط مفقود من عقد 2D-B: ${required}`);
  }
  for (let index = 1; index <= 14; index += 1) {
    const label = `Scenario ${String(index).padStart(2, "0")}`;
    if (!sql.includes(label)) throw new Error(`سيناريو 2D-B مفقود: ${label}`);
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في عقد 2D-B: ${pattern}`);
  }
}

function runDocker(args, input) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 32 * 1024 * 1024,
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
    md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), ''))) FROM public.journal_entry_lines l)
);`;

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--expect-missing"].includes(mode) || process.argv.length > 3) {
    throw new Error("استخدم --check أو --expect-missing");
  }

  const contract = readFileSync(contractPath, "utf8");
  validateExecutorContractSql(contract);
  const migrationExists = existsSync(executorMigrationPath);
  const rollbackExists = existsSync(executorRollbackPath);

  if (mode === "--check") {
    console.log(`تم التحقق من عقد منفذ 2D-B؛ Migration التنفيذ ${migrationExists ? "موجودة" : "غير موجودة"}`);
    return;
  }
  if (migrationExists || rollbackExists) {
    throw new Error("ملفات منفذ 2D-B موجودة بالفعل؛ لم تعد مرحلة TDD الحمراء صالحة");
  }

  assertIsolation(JSON.parse(runDocker(["inspect", container]))[0]);
  const before = psql(businessStateSql);
  const diagnosticMigration = readFileSync(diagnosticMigrationPath, "utf8");
  const lifecycleMigration = readFileSync(lifecycleMigrationPath, "utf8");
  const rebuildMigration = readFileSync(rebuildMigrationPath, "utf8");
  const plannerMigration = readFileSync(plannerMigrationPath, "utf8");

  const output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${diagnosticMigration}
${lifecycleMigration}
${rebuildMigration}
${plannerMigration}
DO $red$
BEGIN
  IF position('missing_inventory_journal_created' IN pg_get_functiondef(
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
  )) > 0 THEN
    RAISE EXCEPTION '2DB_EXECUTOR_UNEXPECTEDLY_ENABLED';
  END IF;
  IF position('REPAIR_TYPE_NOT_ENABLED' IN pg_get_functiondef(
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
  )) = 0 THEN
    RAISE EXCEPTION '2DB_EXECUTOR_GUARD_MISSING';
  END IF;
END;
$red$;
SELECT 'TDD_MISSING_INVENTORY_JOURNAL_EXECUTOR_RED_OK';
ROLLBACK;`);
  const after = psql(businessStateSql);
  if (!output.includes("TDD_MISSING_INVENTORY_JOURNAL_EXECUTOR_RED_OK") || before !== after) {
    throw new Error("فشل إثبات TDD الأحمر لمنفذ 2D-B أو تغيرت بيانات L3");
  }
  console.log("TDD_MISSING_INVENTORY_JOURNAL_EXECUTOR_RED_OK: عقد 2D-B جاهز والمنفذ ما زال محجوبًا");
  console.log("لم تُنفذ سيناريوهات العقد ولم تتغير L3 أو Staging أو أي قاعدة إنتاجية");
}

main();
