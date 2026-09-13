// Transactional rehearsal against the owned Staging project only.
// The migration and every temporary object are rolled back before a second check.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDiagnosticMigrationSql } from "../tests/rehearse-inventory-reconciliation-diagnostic.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const migrationPath = join(root, "supabase/migrations/20260913160000_inventory_reconciliation_diagnostic.sql");
const cliVersion = "supabase@2.116.0";
const signature = "public.get_inventory_reconciliation_diagnostic(text,boolean,text,integer,integer,text)";

const baselineChecks = `
  IF (SELECT count(*) FROM public.products) <> 613
     OR (SELECT count(*) FROM public.inventory_movements) <> 1354
     OR (SELECT count(*) FROM public.sales_invoices) <> 98
     OR (SELECT count(*) FROM public.purchase_invoices) <> 31
     OR (SELECT count(*) FROM public.sales_returns) <> 10
     OR (SELECT count(*) FROM public.purchase_returns) <> 5
     OR (SELECT count(*) FROM public.inventory_adjustments) <> 2
     OR (SELECT count(*) FROM public.journal_entries) <> 310
     OR (SELECT count(*) FROM public.journal_entry_lines) <> 827
  THEN
    RAISE EXCEPTION 'STAGING_BASELINE_CHANGED';
  END IF;`;

export function validateStagingRehearsalSource(source) {
  for (const required of [
    expectedProjectRef,
    "BEGIN;",
    "ROLLBACK;",
    "STAGING_DIAGNOSTIC_REHEARSAL_OK",
    "STAGING_DIAGNOSTIC_ROLLBACK_OK",
    "STAGING_BASELINE_CHANGED",
  ]) {
    if (!source.includes(required)) throw new Error(`حاجز Staging مفقود: ${required}`);
  }
  const forbiddenTargets = [
    ["farida", "-db"].join(""),
    ["alibea", "-db"].join(""),
    ["farida", ".alibea2020.com"].join(""),
    ["alibea", ".alibea2020.com"].join(""),
  ];
  for (const forbidden of forbiddenTargets) {
    if (source.includes(forbidden)) throw new Error(`وجهة إنتاجية ممنوعة: ${forbidden}`);
  }
}

function runCli(filePath, logPath) {
  const result = spawnSync("npx", [
    "-y", cliVersion, "db", "query", "--linked", "--file", filePath,
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 24 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || result.error || /"error"\s*:/.test(output)) {
    writeFileSync(logPath, output, { mode: 0o600 });
    throw new Error(`فشلت تجربة Staging؛ التشخيص المحمي: ${logPath}`);
  }
  return output;
}

function main() {
  if (process.argv.length > 2) throw new Error("هذا المشغل لا يقبل معاملات");
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
  validateStagingRehearsalSource(source);

  const linkedRef = readFileSync(projectRefPath, "utf8").trim();
  if (linkedRef !== expectedProjectRef) {
    throw new Error(`رفض التنفيذ: المشروع المرتبط ${linkedRef || "غير موجود"} ليس Staging المعتمد`);
  }

  const migration = readFileSync(migrationPath, "utf8");
  validateDiagnosticMigrationSql(migration);
  const reportDir = mkdtempSync("/tmp/accounting-staging-inventory-diagnostic-");
  const rehearsalPath = join(reportDir, "rehearsal.sql");
  const verifyPath = join(reportDir, "verify-rollback.sql");
  const logPath = join(reportDir, "run.log");
  const reportPath = join(reportDir, "report.json");

  const rehearsalSql = `BEGIN;
${migration}
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $guard$
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'STAGING_IDENTITY_MISMATCH';
  END IF;
  IF to_regprocedure('${signature}') IS NULL THEN
    RAISE EXCEPTION 'DIAGNOSTIC_FUNCTION_MISSING_AFTER_MIGRATION';
  END IF;
${baselineChecks}
END;
$guard$;

CREATE TEMP TABLE diagnostic_rehearsal_payload AS
SELECT public.get_inventory_reconciliation_diagnostic(
  'summary', true, NULL, 100, 0, NULL
) AS payload;

DO $verify$
DECLARE
  v_payload jsonb;
  v_fingerprint text;
  v_page jsonb;
  v_rejected boolean := false;
BEGIN
  SELECT payload INTO STRICT v_payload FROM diagnostic_rehearsal_payload;
  v_fingerprint := v_payload->>'fingerprint';
  IF v_payload->>'schema_version' <> '1'
     OR v_payload->>'source_scope' <> 'all_recorded_stock_effects'
     OR v_fingerprint IS NULL
     OR round((v_payload#>>'{totals,card_quantity}')::numeric, 2) <> 3880.00
     OR round((v_payload#>>'{totals,movement_quantity}')::numeric, 2) <> 3880.00
     OR round((v_payload#>>'{totals,movement_book_value}')::numeric, 2) <> 483717.12
     OR round((v_payload#>>'{totals,ledger_1104_balance}')::numeric, 2) <> 483717.14
     OR round((v_payload#>>'{totals,movement_to_ledger_difference}')::numeric, 2) <> 0.02
  THEN
    RAISE EXCEPTION 'STAGING_DIAGNOSTIC_TOTALS_MISMATCH';
  END IF;

  v_page := public.get_inventory_reconciliation_diagnostic(
    'products', false, NULL, 1, 0, v_fingerprint
  );
  IF jsonb_typeof(v_page->'rows') <> 'array'
     OR (v_page#>>'{page,total_count}')::integer < 1 THEN
    RAISE EXCEPTION 'STAGING_PRODUCT_PAGE_INVALID';
  END IF;

  v_page := public.get_inventory_reconciliation_diagnostic(
    'sources', false, NULL, 1, 0, v_fingerprint
  );
  IF jsonb_typeof(v_page->'rows') <> 'array'
     OR (v_page#>>'{page,total_count}')::integer < 1 THEN
    RAISE EXCEPTION 'STAGING_SOURCE_PAGE_INVALID';
  END IF;

  BEGIN
    PERFORM public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 501, 0, NULL);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'STAGING_LIMIT_GUARD_FAILED';
  END IF;
END;
$verify$;

SELECT jsonb_build_object(
  'result', 'STAGING_DIAGNOSTIC_REHEARSAL_OK',
  'status', payload->>'status',
  'fingerprint_present', payload->>'fingerprint' IS NOT NULL,
  'product_issues', payload#>>'{totals,product_issue_count}',
  'source_issues', payload#>>'{totals,source_issue_count}',
  'rounding_issues', payload#>>'{totals,rounding_issue_count}',
  'movement_to_ledger_difference', payload#>>'{totals,movement_to_ledger_difference}'
) AS rehearsal
FROM diagnostic_rehearsal_payload;

ROLLBACK;`;

  const verifySql = `BEGIN TRANSACTION READ ONLY;
DO $verify$
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'STAGING_IDENTITY_MISMATCH';
  END IF;
  IF to_regprocedure('${signature}') IS NOT NULL THEN
    RAISE EXCEPTION 'DIAGNOSTIC_FUNCTION_REMAINED_AFTER_ROLLBACK';
  END IF;
${baselineChecks}
END;
$verify$;
SELECT jsonb_build_object(
  'result', 'STAGING_DIAGNOSTIC_ROLLBACK_OK',
  'diagnostic_exists', to_regprocedure('${signature}') IS NOT NULL,
  'products', (SELECT count(*) FROM public.products),
  'inventory_movements', (SELECT count(*) FROM public.inventory_movements),
  'journal_entries', (SELECT count(*) FROM public.journal_entries),
  'journal_entry_lines', (SELECT count(*) FROM public.journal_entry_lines)
) AS verification;
ROLLBACK;`;

  writeFileSync(rehearsalPath, rehearsalSql, { mode: 0o600 });
  writeFileSync(verifyPath, verifySql, { mode: 0o600 });
  const rehearsalOutput = runCli(rehearsalPath, logPath);
  if (!rehearsalOutput.includes("STAGING_DIAGNOSTIC_REHEARSAL_OK")) {
    writeFileSync(logPath, rehearsalOutput, { mode: 0o600 });
    throw new Error(`لم تظهر علامة نجاح التجربة؛ التشخيص المحمي: ${logPath}`);
  }
  const verifyOutput = runCli(verifyPath, logPath);
  if (!verifyOutput.includes("STAGING_DIAGNOSTIC_ROLLBACK_OK")) {
    writeFileSync(logPath, verifyOutput, { mode: 0o600 });
    throw new Error(`لم تظهر علامة نجاح الرجوع؛ التشخيص المحمي: ${logPath}`);
  }

  writeFileSync(reportPath, `${JSON.stringify({
    result: "STAGING_DIAGNOSTIC_TRANSACTIONAL_REHEARSAL_OK",
    verifiedAt: new Date().toISOString(),
    projectRef: expectedProjectRef,
    migration: "20260913160000_inventory_reconciliation_diagnostic.sql",
    migrationRolledBack: true,
    diagnosticRemainedAfterRollback: false,
    baselinePreserved: true,
    productionModified: false,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log("نجحت تجربة Migration على Staging داخل معاملة وانتهت بـ ROLLBACK");
  console.log("تأكد غياب الدالة بعد الرجوع وتطابق خط الأساس؛ لم تتغير Staging أو بيئتا الإنتاج");
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
