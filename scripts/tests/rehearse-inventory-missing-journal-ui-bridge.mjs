// TDD and isolated L3 runner for the server-side 2D UI bridge.
import { chownSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const contractPath = join(root,
  "supabase/tests/inventory_reconciliation_missing_journal_ui_bridge_contract.sql");
const migrationPath = join(root,
  "supabase/migrations/20260922070000_inventory_reconciliation_missing_journal_ui_bridge.sql");
const rollbackPath = join(root,
  "supabase/rollback/20260922070000_inventory_reconciliation_missing_journal_ui_bridge.sql");
const diagnosticMigrationPath = join(root,
  "supabase/migrations/20260913160000_inventory_reconciliation_diagnostic.sql");
const lifecycleMigrationPath = join(root,
  "supabase/migrations/20260913234500_inventory_reconciliation_repair_lifecycle.sql");
const rebuildMigrationPath = join(root,
  "supabase/migrations/20260914190000_inventory_reconciliation_rebuild_product_card_executor.sql");
const systemAccountsMigrationPath = join(root,
  "supabase/migrations/20260921213000_inventory_reconciliation_system_accounts.sql");
const plannerMigrationPath = join(root,
  "supabase/migrations/20260921220000_inventory_reconciliation_missing_journal_plan.sql");
const executorMigrationPath = join(root,
  "supabase/migrations/20260921233000_inventory_reconciliation_missing_journal_executor.sql");
const executorContractPath = join(root,
  "supabase/tests/inventory_reconciliation_missing_journal_executor_contract.sql");
const marker = "INVENTORY_RECONCILIATION_MISSING_JOURNAL_UI_BRIDGE_CONTRACT_OK";

export function validateUiBridgeContract(sql) {
  for (const required of [
    marker,
    "ROLLBACK;",
    "fn_prepare_inventory_missing_journal_repair_item",
    "trg_prepare_inventory_missing_journal_repair_item",
    "REPAIR_ACCOUNTING_DATE_REQUIRED",
    "Scenario 07",
  ]) {
    if (!sql.includes(required)) throw new Error(`حاجز أو شرط مفقود من عقد جسر واجهة 2D: ${required}`);
  }
  for (let index = 1; index <= 7; index += 1) {
    const label = `Scenario ${String(index).padStart(2, "0")}`;
    if (!sql.includes(label)) throw new Error(`سيناريو جسر واجهة 2D مفقود: ${label}`);
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في عقد جسر واجهة 2D: ${pattern}`);
  }
}

export function validateUiBridgeMigration(sql) {
  for (const required of [
    "INVENTORY_MISSING_JOURNAL_UI_BRIDGE_BASELINE_MISMATCH",
    "CREATE FUNCTION public.fn_prepare_inventory_missing_journal_repair_item()",
    "CREATE TRIGGER trg_prepare_inventory_missing_journal_repair_item",
    "REPAIR_ACCOUNTING_DATE_REQUIRED",
    "REPAIR_JOURNAL_PLAN_INVALID",
    "NEW.precondition_hash := md5",
    "REVOKE ALL ON FUNCTION",
  ]) {
    if (!sql.includes(required)) throw new Error(`جزء مفقود من Migration جسر واجهة 2D: ${required}`);
  }
  for (const pattern of [
    /\bCOMMIT\b/i, /\bTRUNCATE\b/i, /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /(?:farida|alibea)-db/i, /https?:\/\//i, /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في Migration جسر واجهة 2D: ${pattern}`);
  }
}

export function validateUiBridgeRollback(sql) {
  for (const required of [
    "STAGING_20260922070000",
    "INVENTORY_MISSING_JOURNAL_UI_BRIDGE_ROLLBACK_NOT_AUTHORIZED",
    "INVENTORY_MISSING_JOURNAL_UI_BRIDGE_ROLLBACK_ACTIVE_REPAIRS",
    "DROP TRIGGER trg_prepare_inventory_missing_journal_repair_item",
    "DROP FUNCTION public.fn_prepare_inventory_missing_journal_repair_item()",
  ]) {
    if (!sql.includes(required)) throw new Error(`جزء مفقود من رجوع جسر واجهة 2D: ${required}`);
  }
  for (const pattern of [
    /\bCOMMIT\b/i, /\bCASCADE\b/i, /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /(?:farida|alibea)-db/i, /https?:\/\//i, /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في رجوع جسر واجهة 2D: ${pattern}`);
  }
}

function runDocker(args, input) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 240000,
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

function writeDiagnostic(path, message) {
  writeFileSync(path, `${message}\n`, { mode: 0o600 });
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  if (Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) {
    chownSync(path, uid, gid);
  }
}

function migration(path) {
  return readFileSync(path, "utf8");
}

function executorFixturePrelude() {
  const sql = readFileSync(executorContractPath, "utf8");
  const scenarioIndex = sql.indexOf("-- Scenario 01:");
  if (scenarioIndex < 0) throw new Error("تعذر استخراج تجهيزات عقد منفذ 2D");
  return sql.slice(0, scenarioIndex)
    .replace(/^\\set ON_ERROR_STOP on\s*/m, "")
    .replace(/^BEGIN;\s*/m, "");
}

const baseMigrations = () => [
  diagnosticMigrationPath,
  lifecycleMigrationPath,
  rebuildMigrationPath,
  systemAccountsMigrationPath,
  plannerMigrationPath,
  executorMigrationPath,
].map(migration).join("\n");

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--expect-missing", "--run-migration", "--test-explicit-rollback"].includes(mode)
      || process.argv.length > 3) {
    throw new Error("استخدم --check أو --expect-missing أو --run-migration أو --test-explicit-rollback");
  }
  const contract = readFileSync(contractPath, "utf8");
  validateUiBridgeContract(contract);
  const migrationExists = existsSync(migrationPath);
  const rollbackExists = existsSync(rollbackPath);

  if (mode === "--check") {
    if (migrationExists !== rollbackExists) throw new Error("يجب وجود Migration جسر 2D وملف رجوعها معًا");
    if (migrationExists) {
      validateUiBridgeMigration(migration(migrationPath));
      validateUiBridgeRollback(migration(rollbackPath));
    }
    console.log(`تم التحقق من عقد جسر واجهة 2D؛ Migration ${migrationExists ? "موجودة" : "غير موجودة"}`);
    return;
  }
  if (mode === "--expect-missing" && (migrationExists || rollbackExists)) {
    throw new Error("ملفات جسر واجهة 2D موجودة بالفعل؛ لم تعد مرحلة TDD الحمراء صالحة");
  }
  if (!["--expect-missing", "--check"].includes(mode) && (!migrationExists || !rollbackExists)) {
    throw new Error("Migration جسر واجهة 2D أو ملف رجوعها غير موجود");
  }

  assertIsolation(JSON.parse(runDocker(["inspect", container]))[0]);
  if (mode === "--expect-missing") {
    const output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${baseMigrations()}
DO $red$
BEGIN
  IF to_regprocedure('public.fn_prepare_inventory_missing_journal_repair_item()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.inventory_reconciliation_repair_items'::regclass
         AND tgname = 'trg_prepare_inventory_missing_journal_repair_item'
         AND NOT tgisinternal) THEN
    RAISE EXCEPTION '2D_UI_BRIDGE_UNEXPECTEDLY_EXISTS';
  END IF;
END;
$red$;
SELECT 'TDD_MISSING_INVENTORY_JOURNAL_UI_BRIDGE_RED_OK';
ROLLBACK;`);
    if (!output.includes("TDD_MISSING_INVENTORY_JOURNAL_UI_BRIDGE_RED_OK")) {
      throw new Error("فشل إثبات TDD الأحمر لجسر واجهة 2D");
    }
    console.log("TDD_MISSING_INVENTORY_JOURNAL_UI_BRIDGE_RED_OK: العقد جاهز والجسر غير موجود كما هو متوقع");
    console.log("لم تُنفذ سيناريوهات العقد ولم تتغير L3 أو Staging أو الإنتاج");
    return;
  }

  validateUiBridgeMigration(migration(migrationPath));
  validateUiBridgeRollback(migration(rollbackPath));
  if (mode === "--test-explicit-rollback") {
    const reportDir = mkdtempSync("/tmp/accounting-inventory-missing-journal-ui-bridge-rollback-report-");
    const logPath = join(reportDir, "run.log");
    let output;
    try {
      output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${baseMigrations()}
${migration(migrationPath)}
SELECT set_config('app.inventory_missing_journal_ui_bridge_rollback_authorized',
  'STAGING_20260922070000', true);
${migration(rollbackPath)}
DO $verify$
BEGIN
  IF to_regprocedure('public.fn_prepare_inventory_missing_journal_repair_item()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.inventory_reconciliation_repair_items'::regclass
         AND tgname = 'trg_prepare_inventory_missing_journal_repair_item'
         AND NOT tgisinternal)
     OR to_regprocedure('public.execute_inventory_reconciliation_repair(uuid,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION '2D_UI_BRIDGE_EXPLICIT_ROLLBACK_FAILED';
  END IF;
END;
$verify$;
SELECT 'INVENTORY_MISSING_JOURNAL_UI_BRIDGE_EXPLICIT_ROLLBACK_OK';
ROLLBACK;`);
    } catch (error) {
      writeDiagnostic(logPath, error.message);
      throw new Error(`فشل اختبار رجوع جسر واجهة 2D؛ التشخيص المحمي: ${logPath}`);
    }
    if (!output.includes("INVENTORY_MISSING_JOURNAL_UI_BRIDGE_EXPLICIT_ROLLBACK_OK")) {
      throw new Error("لم تظهر علامة نجاح رجوع جسر واجهة 2D");
    }
    const reportPath = join(reportDir, "report.json");
    writeFileSync(reportPath, `${JSON.stringify({
      status: "INVENTORY_MISSING_JOURNAL_UI_BRIDGE_EXPLICIT_ROLLBACK_OK",
      verifiedAt: new Date().toISOString(),
      container,
      database,
      bridgeRemoved: true,
      plannerAndExecutorPreserved: true,
      transactionRolledBack: true,
      productionOrHostedStagingModified: false,
    }, null, 2)}\n`, { mode: 0o600 });
    console.log("نجح اختبار ملف رجوع جسر واجهة 2D داخل L3 المعزولة");
    console.log("أزيل الجسر وبقي مخطط ومنفذ 2D كما هما؛ لم تتغير Staging أو الإنتاج");
    console.log(`التقرير: ${reportPath}`);
    return;
  }

  const reportDir = mkdtempSync("/tmp/accounting-inventory-missing-journal-ui-bridge-report-");
  const logPath = join(reportDir, "run.log");
  let output;
  try {
    output = psql(`\\set ON_ERROR_STOP on
BEGIN;
${baseMigrations()}
${migration(migrationPath)}
${executorFixturePrelude()}
${contract}`);
  } catch (error) {
    writeDiagnostic(logPath, error.message);
    throw new Error(`فشل اختبار Migration جسر واجهة 2D؛ التشخيص المحمي: ${logPath}`);
  }
  if (!output.includes(marker)) throw new Error("لم تظهر علامة نجاح عقد جسر واجهة 2D");
  const reportPath = join(reportDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify({
    status: marker,
    verifiedAt: new Date().toISOString(),
    scenarios: 7,
    container,
    database,
    transactionRolledBack: true,
    clientJournalLinesIgnored: true,
    uiDraftExecutedAtomically: true,
    productionOrHostedStagingModified: false,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجحت Migration جسر واجهة 2D في السيناريوهات السبعة داخل L3 المعزولة");
  console.log("تم الرجوع عن الجسر والعينات بالكامل؛ لم تتغير L3 أو Staging أو الإنتاج");
  console.log(`التقرير: ${reportPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
