// Transactional rehearsal of stages 2D-A/2D-B against the owned Staging project only.
import { createHash } from "node:crypto";
import { chownSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateMissingJournalPlanContract,
  validateMissingJournalPlanMigration,
  validateMissingJournalPlanRollback,
} from "../tests/rehearse-inventory-missing-journal-plan.mjs";
import {
  validateExecutorContractSql,
  validateExecutorMigrationSql,
  validateExecutorRollbackSql,
} from "../tests/rehearse-inventory-missing-journal-executor.mjs";
import {
  validateSystemAccountsContractSql,
  validateSystemAccountsMigrationSql,
  validateSystemAccountsRollbackSql,
} from "../tests/rehearse-inventory-reconciliation-system-accounts.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const systemAccountsMigrationPath = join(root,
  "supabase/migrations/20260921213000_inventory_reconciliation_system_accounts.sql");
const plannerMigrationPath = join(root,
  "supabase/migrations/20260921220000_inventory_reconciliation_missing_journal_plan.sql");
const executorMigrationPath = join(root,
  "supabase/migrations/20260921233000_inventory_reconciliation_missing_journal_executor.sql");
const systemAccountsRollbackPath = join(root,
  "supabase/rollback/20260921213000_inventory_reconciliation_system_accounts.sql");
const plannerRollbackPath = join(root,
  "supabase/rollback/20260921220000_inventory_reconciliation_missing_journal_plan.sql");
const executorRollbackPath = join(root,
  "supabase/rollback/20260921233000_inventory_reconciliation_missing_journal_executor.sql");
const systemAccountsContractPath = join(root,
  "supabase/tests/inventory_reconciliation_system_accounts_contract.sql");
const plannerContractPath = join(root,
  "supabase/tests/inventory_reconciliation_missing_journal_plan_contract.sql");
const executorContractPath = join(root,
  "supabase/tests/inventory_reconciliation_missing_journal_executor_contract.sql");
const baselineArchive = "/backups/staging/inventory-missing-journal-before-20260922-012321";
const baselinePath = join(baselineArchive, "baseline.json");
const manifestPath = join(baselineArchive, "manifest.json");
const cli = "supabase@2.116.0";
const systemAccountsMarker = "INVENTORY_RECONCILIATION_SYSTEM_ACCOUNTS_CONTRACT_OK";
const plannerMarker = "INVENTORY_RECONCILIATION_MISSING_JOURNAL_PLAN_CONTRACT_OK";
const executorMarker = "INVENTORY_RECONCILIATION_MISSING_JOURNAL_EXECUTOR_CONTRACT_OK";
const rollbackMarker = "STAGING_INVENTORY_MISSING_JOURNAL_EXPLICIT_ROLLBACK_OK";

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") {
      throw new Error("شغّل المشغل بواسطة sudo من حساب deploy فقط");
    }
    const tokenPath = "/home/deploy/.supabase/access-token";
    const accessToken = readFileSync(tokenPath, "utf8").trim();
    if (!accessToken) throw new Error("جلسة Supabase للمستخدم deploy غير موجودة");
    return {
      ...process.env,
      HOME: "/home/deploy",
      SUPABASE_ACCESS_TOKEN: accessToken,
    };
  }
  return process.env;
}

export function validateStagingMissingJournalRehearsalSource(source) {
  for (const required of [
    expectedProjectRef,
    baselineArchive,
    "BEGIN;",
    "ROLLBACK;",
    systemAccountsMarker,
    plannerMarker,
    executorMarker,
    rollbackMarker,
    "20260921213000",
    "20260921220000",
    "20260921233000",
    "STAGING_20260921213000",
    "STAGING_20260921220000",
    "STAGING_20260921233000",
  ]) {
    if (!source.includes(required)) throw new Error(`حاجز تجربة Staging مفقود: ${required}`);
  }
  for (const forbidden of [
    ["farida", "-db"].join(""),
    ["alibea", "-db"].join(""),
    ["farida", ".alibea2020.com"].join(""),
    ["alibea", ".alibea2020.com"].join(""),
    ["COM", "MIT;"].join(""),
  ]) {
    if (source.includes(forbidden)) throw new Error(`وجهة أو عبارة ممنوعة: ${forbidden}`);
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeDiagnostic(path, message) {
  writeFileSync(path, message, { mode: 0o600 });
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  if (Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) {
    chownSync(path, uid, gid);
  }
}

function runCli(filePath, logPath, label) {
  const result = spawnSync("npx", [
    "-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", filePath,
  ], {
    cwd: root,
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 420000,
    maxBuffer: 96 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    writeDiagnostic(logPath, `${label}\n${output}\n${result.error?.stack ?? ""}`);
    throw new Error(`فشلت تجربة 2D على Staging (${label})؛ التشخيص المحمي: ${logPath}`);
  }
  return result.stdout;
}

function stripL3OnlyContractParts(contract) {
  const staging = contract
    .replace(/^\\set ON_ERROR_STOP on\s*/m, "")
    .replace(/^BEGIN;\s*/m, "")
    .replace("current_database() <> 'l3_public_restore'", "current_database() <> 'postgres'")
    .replace(
      /CREATE OR REPLACE FUNCTION auth\.role\(\)[\s\S]*?\$\$;\s*CREATE OR REPLACE FUNCTION auth\.uid\(\)[\s\S]*?\$\$;\s*/,
      "",
    );
  if (staging.includes("CREATE OR REPLACE FUNCTION auth.role()")
      || staging.includes("CREATE OR REPLACE FUNCTION auth.uid()")
      || staging.includes("l3_public_restore")) {
    throw new Error("تعذر فصل محاكاة هوية L3 عن عقد Staging");
  }
  return staging;
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

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function equalJson(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function extractNamedPayload(output, name) {
  const parsed = typeof output === "string" ? JSON.parse(output) : output;
  const visit = (value) => {
    if (!value || typeof value !== "object") return undefined;
    if (Object.prototype.hasOwnProperty.call(value, name)) return value[name];
    for (const child of Object.values(value)) {
      const found = visit(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return visit(parsed);
}

export function verificationSql() {
  return `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT jsonb_build_object(
  'result', 'STAGING_INVENTORY_MISSING_JOURNAL_BASELINE_VERIFICATION_OK',
  'migration_state', jsonb_build_object(
    'system_accounts', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921213000'),
    'planner_2da', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921220000'),
    'executor_2db', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260921233000')
  ),
  'function_state', jsonb_build_object(
    'diagnostic', to_regprocedure('public.get_inventory_reconciliation_diagnostic(text,boolean,text,integer,integer,text)') IS NOT NULL,
    'repair_executor', to_regprocedure('public.execute_inventory_reconciliation_repair(uuid,integer,uuid)') IS NOT NULL,
    'system_account_delete_guard', to_regprocedure('public.fn_guard_system_accounts_delete()') IS NOT NULL
      OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.accounts'::regclass
        AND tgname = 'trg_guard_system_accounts_delete' AND NOT tgisinternal),
    'rebuild_enabled', position('product_card_rebuilt' IN pg_get_functiondef(
      'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure)) > 0,
    'missing_journal_enabled', position('missing_inventory_journal_created' IN pg_get_functiondef(
      'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure)) > 0,
    'journal_planner', to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NOT NULL,
    'planner_base_internal', to_regprocedure('public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)') IS NOT NULL,
    'rebuild_internal', to_regprocedure('public.execute_inventory_reconciliation_repair_rebuild_2c(uuid,integer,uuid)') IS NOT NULL
  ),
  'account_map', COALESCE((SELECT jsonb_object_agg(code, account_count ORDER BY code)
    FROM (SELECT code, count(*) AS account_count FROM public.accounts
      WHERE code IN ('1103','1104','1105','2101','2102','4101','4201','5101','5108','5201')
      GROUP BY code) mapped), '{}'::jsonb),
  'counts', jsonb_build_object(
    'products', (SELECT count(*) FROM public.products),
    'inventory_movements', (SELECT count(*) FROM public.inventory_movements),
    'sales_invoices', (SELECT count(*) FROM public.sales_invoices),
    'sales_returns', (SELECT count(*) FROM public.sales_returns),
    'purchase_invoices', (SELECT count(*) FROM public.purchase_invoices),
    'purchase_returns', (SELECT count(*) FROM public.purchase_returns),
    'inventory_adjustments', (SELECT count(*) FROM public.inventory_adjustments),
    'journal_entries', (SELECT count(*) FROM public.journal_entries),
    'journal_entry_lines', (SELECT count(*) FROM public.journal_entry_lines),
    'repairs', (SELECT count(*) FROM public.inventory_reconciliation_repairs),
    'repair_items', (SELECT count(*) FROM public.inventory_reconciliation_repair_items),
    'repair_effects', (SELECT count(*) FROM public.inventory_reconciliation_repair_effects),
    'repair_events', (SELECT count(*) FROM public.inventory_reconciliation_repair_events)
  ),
  'signatures', jsonb_build_object(
    'products', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.products p),
    'inventory_movements', (SELECT md5(COALESCE(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id), '')) FROM public.inventory_movements m),
    'sales_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), '')) FROM public.sales_invoices s),
    'sales_returns', (SELECT md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), '')) FROM public.sales_returns s),
    'purchase_invoices', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.purchase_invoices p),
    'purchase_returns', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.purchase_returns p),
    'inventory_adjustments', (SELECT md5(COALESCE(string_agg(to_jsonb(a)::text, '|' ORDER BY a.id), '')) FROM public.inventory_adjustments a),
    'journal_entries', (SELECT md5(COALESCE(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id), '')) FROM public.journal_entries j),
    'journal_entry_lines', (SELECT md5(COALESCE(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), '')) FROM public.journal_entry_lines l),
    'repairs', (SELECT md5(COALESCE(string_agg(to_jsonb(r)::text, '|' ORDER BY r.id), '')) FROM public.inventory_reconciliation_repairs r),
    'repair_items', (SELECT md5(COALESCE(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id), '')) FROM public.inventory_reconciliation_repair_items i),
    'repair_effects', (SELECT md5(COALESCE(string_agg(to_jsonb(e)::text, '|' ORDER BY e.id), '')) FROM public.inventory_reconciliation_repair_effects e),
    'repair_events', (SELECT md5(COALESCE(string_agg(to_jsonb(e)::text, '|' ORDER BY e.id), '')) FROM public.inventory_reconciliation_repair_events e)
  ),
  'diagnostic', public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)
) AS verification;
ROLLBACK;
`;
}

function assertBaseline(verification, baseline) {
  const functions = verification?.function_state ?? {};
  const migrations = verification?.migration_state ?? {};
  return verification?.result === "STAGING_INVENTORY_MISSING_JOURNAL_BASELINE_VERIFICATION_OK"
    && !migrations.system_accounts
    && !migrations.planner_2da
    && !migrations.executor_2db
    && functions.diagnostic
    && functions.repair_executor
    && !functions.system_account_delete_guard
    && functions.rebuild_enabled
    && !functions.missing_journal_enabled
    && !functions.journal_planner
    && !functions.planner_base_internal
    && !functions.rebuild_internal
    && equalJson(verification.account_map, baseline.account_map)
    && equalJson(verification.counts, baseline.counts)
    && equalJson(verification.signatures, baseline.signatures)
    && equalJson(stableDiagnostic(verification.diagnostic), stableDiagnostic(baseline.diagnostic));
}

function writeBaselineMismatch(logPath, phase, verification, baseline) {
  writeDiagnostic(logPath, `${JSON.stringify({
    phase,
    expected: {
      account_map: baseline.account_map,
      counts: baseline.counts,
      signatures: baseline.signatures,
      diagnostic: stableDiagnostic(baseline.diagnostic),
    },
    actual: {
      result: verification?.result,
      migration_state: verification?.migration_state,
      function_state: verification?.function_state,
      account_map: verification?.account_map,
      counts: verification?.counts,
      signatures: verification?.signatures,
      diagnostic: stableDiagnostic(verification?.diagnostic),
    },
  }, null, 2)}\n`);
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  validateStagingMissingJournalRehearsalSource(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  const linkedRef = readFileSync(projectRefPath, "utf8").trim();
  if (linkedRef !== expectedProjectRef) {
    throw new Error(`رفض التنفيذ: المشروع المرتبط ${linkedRef || "غير موجود"} ليس Staging المعتمد`);
  }

  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.result !== "STAGING_INVENTORY_MISSING_JOURNAL_BASELINE_OK"
      || manifest.projectRef !== expectedProjectRef
      || manifest.files?.["baseline.json"]?.sha256 !== sha256(baselinePath)
      || baseline.migration_state?.system_accounts
      || baseline.migration_state?.planner_2da
      || baseline.migration_state?.executor_2db
      || baseline.function_state?.journal_planner
      || baseline.function_state?.missing_journal_enabled) {
    throw new Error("خط أساس Staging قبل 2D غير صالح أو تغيرت بصمته");
  }

  const systemAccountsMigration = readFileSync(systemAccountsMigrationPath, "utf8");
  const plannerMigration = readFileSync(plannerMigrationPath, "utf8");
  const executorMigration = readFileSync(executorMigrationPath, "utf8");
  const systemAccountsRollback = readFileSync(systemAccountsRollbackPath, "utf8");
  const plannerRollback = readFileSync(plannerRollbackPath, "utf8");
  const executorRollback = readFileSync(executorRollbackPath, "utf8");
  const systemAccountsContract = readFileSync(systemAccountsContractPath, "utf8");
  const plannerContract = readFileSync(plannerContractPath, "utf8");
  const executorContract = readFileSync(executorContractPath, "utf8");
  validateSystemAccountsMigrationSql(systemAccountsMigration);
  validateSystemAccountsRollbackSql(systemAccountsRollback);
  validateSystemAccountsContractSql(systemAccountsContract);
  validateMissingJournalPlanMigration(plannerMigration);
  validateMissingJournalPlanRollback(plannerRollback);
  validateMissingJournalPlanContract(plannerContract);
  validateExecutorMigrationSql(executorMigration);
  validateExecutorRollbackSql(executorRollback);
  validateExecutorContractSql(executorContract);
  const stagingSystemAccountsContract = stripL3OnlyContractParts(systemAccountsContract);
  const stagingPlannerContract = stripL3OnlyContractParts(plannerContract);
  const stagingExecutorContract = stripL3OnlyContractParts(executorContract);

  const reportDir = mkdtempSync("/tmp/accounting-staging-inventory-missing-journal-rehearsal-");
  const systemAccountsRehearsalPath = join(reportDir, "system-accounts-rehearsal.sql");
  const plannerRehearsalPath = join(reportDir, "planner-rehearsal.sql");
  const executorRehearsalPath = join(reportDir, "executor-rehearsal.sql");
  const rollbackTestPath = join(reportDir, "explicit-rollback.sql");
  const verificationPath = join(reportDir, "post-rollback-verification.sql");
  const logPath = join(reportDir, "run.log");
  const reportPath = join(reportDir, "report.json");

  writeFileSync(verificationPath, verificationSql(), { mode: 0o600 });
  const preflightOutput = runCli(verificationPath, logPath, "baseline-preflight");
  const preflight = extractNamedPayload(preflightOutput, "verification");
  if (!assertBaseline(preflight, baseline)) {
    writeBaselineMismatch(logPath, "baseline-preflight", preflight, baseline);
    throw new Error(`تغيرت Staging منذ النسخة الاحتياطية؛ أُلغيت التجربة: ${logPath}`);
  }

  writeFileSync(systemAccountsRehearsalPath,
    `BEGIN;\n${systemAccountsMigration}\n${stagingSystemAccountsContract}`,
    { mode: 0o600 });
  writeFileSync(plannerRehearsalPath,
    `BEGIN;\n${systemAccountsMigration}\n${plannerMigration}\n${stagingPlannerContract}`,
    { mode: 0o600 });
  writeFileSync(executorRehearsalPath,
    `BEGIN;\n${systemAccountsMigration}\n${plannerMigration}\n${executorMigration}\n${stagingExecutorContract}`,
    { mode: 0o600 });
  writeFileSync(rollbackTestPath, `BEGIN;
${systemAccountsMigration}
${plannerMigration}
${executorMigration}
SELECT set_config('app.inventory_missing_journal_executor_rollback_authorized', 'STAGING_20260921233000', true);
${executorRollback}
SELECT set_config('app.inventory_missing_journal_plan_rollback_authorized', 'STAGING_20260921220000', true);
${plannerRollback}
SELECT set_config('app.inventory_reconciliation_accounts_rollback_authorized', 'STAGING_20260921213000', true);
${systemAccountsRollback}
DO $verify$
BEGIN
  IF to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NOT NULL
     OR to_regprocedure('public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)') IS NOT NULL
     OR to_regprocedure('public.execute_inventory_reconciliation_repair_rebuild_2c(uuid,integer,uuid)') IS NOT NULL
     OR to_regprocedure('public.fn_guard_system_accounts_delete()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.accounts'::regclass
       AND tgname = 'trg_guard_system_accounts_delete' AND NOT tgisinternal)
     OR EXISTS (SELECT 1 FROM public.accounts WHERE description IN (
       'SYSTEM:INVENTORY_RECONCILIATION_GAIN:20260921213000',
       'SYSTEM:INVENTORY_RECONCILIATION_LOSS:20260921213000'))
     OR position('product_card_rebuilt' IN pg_get_functiondef(
       'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure)) = 0
     OR position('missing_inventory_journal_created' IN pg_get_functiondef(
       'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'STAGING_INVENTORY_MISSING_JOURNAL_EXPLICIT_ROLLBACK_FAILED';
  END IF;
END;
$verify$;
SELECT '${rollbackMarker}';
ROLLBACK;
`, { mode: 0o600 });

  const systemAccountsOutput = runCli(
    systemAccountsRehearsalPath, logPath, "system-accounts-migration-contract");
  if (!systemAccountsOutput.includes(systemAccountsMarker)) {
    throw new Error(`لم تظهر علامة نجاح حسابات النظام؛ التشخيص المحمي: ${logPath}`);
  }
  const plannerOutput = runCli(plannerRehearsalPath, logPath, "planner-migration-contract");
  if (!plannerOutput.includes(plannerMarker)) {
    throw new Error(`لم تظهر علامة نجاح سيناريوهات 2D-A؛ التشخيص المحمي: ${logPath}`);
  }
  const executorOutput = runCli(executorRehearsalPath, logPath, "executor-migration-contract");
  if (!executorOutput.includes(executorMarker)) {
    throw new Error(`لم تظهر علامة نجاح سيناريوهات 2D-B؛ التشخيص المحمي: ${logPath}`);
  }
  const rollbackOutput = runCli(rollbackTestPath, logPath, "explicit-rollback");
  if (!rollbackOutput.includes(rollbackMarker)) {
    throw new Error(`لم تظهر علامة نجاح الرجوع الصريح؛ التشخيص المحمي: ${logPath}`);
  }
  const verificationOutput = runCli(verificationPath, logPath, "post-rollback-verification");
  const verification = extractNamedPayload(verificationOutput, "verification");
  if (!assertBaseline(verification, baseline)) {
    writeBaselineMismatch(logPath, "post-rollback-verification", verification, baseline);
    throw new Error(`لم تعد Staging إلى خط الأساس بعد التجربة؛ التشخيص المحمي: ${logPath}`);
  }

  writeFileSync(reportPath, `${JSON.stringify({
    result: "STAGING_INVENTORY_MISSING_JOURNAL_TRANSACTIONAL_REHEARSAL_OK",
    verifiedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    baselineArchive,
    systemAccountsMigration: systemAccountsMigrationPath.split("/").at(-1),
    plannerMigration: plannerMigrationPath.split("/").at(-1),
    executorMigration: executorMigrationPath.split("/").at(-1),
    scenarios: {
      systemAccounts: 8,
      planner: 18,
      executor: 14,
      total: 40,
    },
    contractRolledBack: true,
    explicitRollbackVerified: true,
    businessRepairAndDiagnosticBaselinePreserved: true,
    accountMapPreserved: true,
    permanentAccountCreation: false,
    missingRequiredAccount: baseline.account_map?.["5201"] ? null : "5201",
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });

  console.log("نجحت تجربة حسابات النظام و2D-A و2D-B على Staging داخل معاملات انتهت بـ ROLLBACK كامل");
  console.log("نجحت السيناريوهات الأربعون والرجوع الصريح، وتطابقت بيانات الأعمال والمعالجات والتشخيص مع خط الأساس");
  console.log("لم يُنشأ الحساب 5201 أو أي حساب دائم أثناء التجربة");
  console.log(`REPORT_DIR=${reportDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
