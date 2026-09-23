// Apply or explicitly roll back the controlled taxed-purchase fixture on Staging.
import { isDeepStrictEqual } from "node:util";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acceptanceFixture as fixture,
  baselineSql,
  extractNamedPayload,
  validateBaseline,
} from "./backup-inventory-tax-purchase-acceptance-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const baselineDir = "/tmp/staging-inventory-tax-purchase-acceptance-before-mS6b33";
const cli = "supabase@2.116.0";

function assertStagingLink() {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض الإجراء: المشروع المرتبط ليس Staging المعتمد");
  }
}

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") throw new Error("شغّل الإجراء بواسطة sudo من حساب deploy فقط");
    const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
    if (!token) throw new Error("جلسة Supabase للمستخدم deploy غير موجودة");
    return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: token };
  }
  return process.env;
}

function runCli(sql, label, reportDir) {
  assertStagingLink();
  const sqlPath = join(reportDir, `${label}.sql`);
  const logPath = join(reportDir, `${label}.log`);
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  const result = spawnSync("npx", [
    "-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", sqlPath,
  ], {
    cwd: root,
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  writeFileSync(logPath, output, { mode: 0o600 });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    throw new Error(`فشل ${label} لحالة الشراء الضريبية؛ التشخيص: ${logPath}`);
  }
  return JSON.parse(result.stdout);
}

function normalizeBaseline(value) {
  const normalized = structuredClone(value);
  if (normalized?.diagnostic) delete normalized.diagnostic.snapshot_at;
  return normalized;
}

function assertSameBaseline(actual, expected, label, reportDir) {
  if (!isDeepStrictEqual(normalizeBaseline(actual), normalizeBaseline(expected))) {
    writeFileSync(join(reportDir, `${label}-mismatch.json`), `${JSON.stringify({ expected, actual }, null, 2)}\n`, { mode: 0o600 });
    throw new Error(`تغير خط أساس Staging في ${label}؛ أُلغي الإجراء`);
  }
}

const environmentGuard = `
DO $environment_guard$
BEGIN
  IF current_database() <> 'postgres'
     OR current_setting('server_version') NOT LIKE '17.%'
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923100000')
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923130000')
     OR to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NULL
     OR to_regprocedure('public.execute_inventory_reconciliation_repair(uuid,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'STAGING_TAX_PURCHASE_ACCEPTANCE_ENVIRONMENT_INVALID';
  END IF;
END;
$environment_guard$;
`;

const absenceGuard = `
DO $absence_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE id = '${fixture.productId}'::uuid OR code = '${fixture.productCode}')
     OR EXISTS (SELECT 1 FROM public.purchase_invoices WHERE id = '${fixture.invoiceId}'::uuid OR invoice_number = ${fixture.invoiceNumber})
     OR EXISTS (SELECT 1 FROM public.purchase_invoice_items WHERE id = '${fixture.itemId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_items
       WHERE source_type = 'purchase_invoice' AND source_id = '${fixture.invoiceId}'::uuid) THEN
    RAISE EXCEPTION 'STAGING_TAX_PURCHASE_ACCEPTANCE_FIXTURE_ALREADY_EXISTS';
  END IF;
END;
$absence_guard$;
`;

const insertFixture = `
UPDATE public.company_settings
SET enable_tax = true, tax_rate = 14
WHERE id = (SELECT id FROM public.company_settings ORDER BY created_at LIMIT 1)
  AND enable_tax IS FALSE AND tax_rate = 0
  AND purchase_tax_account_id = (SELECT id FROM public.accounts WHERE code = '1105')
  AND sales_tax_account_id = (SELECT id FROM public.accounts WHERE code = '2104');

DO $settings_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_settings s
    JOIN public.accounts p ON p.id = s.purchase_tax_account_id
    JOIN public.accounts v ON v.id = s.sales_tax_account_id
    WHERE s.enable_tax IS TRUE AND s.tax_rate = 14
      AND p.code = '1105' AND p.is_system IS TRUE
      AND v.code = '2104' AND v.is_system IS TRUE
  ) THEN
    RAISE EXCEPTION 'STAGING_TAX_PURCHASE_ACCEPTANCE_SETTINGS_INVALID';
  END IF;
END;
$settings_guard$;

INSERT INTO public.products(
  id, code, name, purchase_price, selling_price, quantity_on_hand, min_stock_level, is_active
) VALUES (
  '${fixture.productId}'::uuid, '${fixture.productCode}',
  'منتج اختبار قبول فاتورة شراء ضريبية', 50, 75, 2, 0, true
);

INSERT INTO public.purchase_invoices(
  id, invoice_number, invoice_date, status, subtotal, discount, tax, total,
  paid_amount, notes, journal_entry_id
) VALUES (
  '${fixture.invoiceId}'::uuid, ${fixture.invoiceNumber}, current_date, 'posted',
  100, 0, 14, 114, 0, '__TAX_PURCHASE_ACCEPTANCE_WITHOUT_JOURNAL__', NULL
);

INSERT INTO public.purchase_invoice_items(
  id, invoice_id, product_id, description, quantity, unit_price, discount, total, net_total
) VALUES (
  '${fixture.itemId}'::uuid, '${fixture.invoiceId}'::uuid, '${fixture.productId}'::uuid,
  'بند اختبار شراء خاضع لضريبة 14%', 2, 50, 0, 100, 100
);

INSERT INTO public.inventory_movements(
  id, product_id, movement_type, quantity, unit_cost, total_cost,
  reference_id, reference_type, notes, movement_date
) VALUES (
  '${fixture.movementId}'::uuid, '${fixture.productId}'::uuid, 'purchase', 2, 50, 100,
  '${fixture.invoiceId}'::uuid, 'purchase_invoice', '__TAX_PURCHASE_ACCEPTANCE__', current_date
);
`;

export const applySql = `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
${environmentGuard}
${absenceGuard}
${insertFixture}
SELECT jsonb_build_object(
  'result', 'STAGING_TAX_PURCHASE_ACCEPTANCE_FIXTURE_READY',
  'source_type', 'purchase_invoice',
  'source_id', '${fixture.invoiceId}',
  'invoice_number', ${fixture.invoiceNumber},
  'product_code', '${fixture.productCode}',
  'tax_rate', 14
) AS fixture_apply;
COMMIT;
`;

export const explicitRollbackSql = `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
${environmentGuard}
DO $rollback_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_invoices
    WHERE id = '${fixture.invoiceId}'::uuid
      AND invoice_number = ${fixture.invoiceNumber}
      AND notes = '__TAX_PURCHASE_ACCEPTANCE_WITHOUT_JOURNAL__'
      AND journal_entry_id IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = '${fixture.productId}'::uuid AND code = '${fixture.productCode}'
  ) OR EXISTS (
    SELECT 1 FROM public.inventory_reconciliation_repair_items
    WHERE source_type = 'purchase_invoice' AND source_id = '${fixture.invoiceId}'::uuid
  ) THEN
    RAISE EXCEPTION 'STAGING_TAX_PURCHASE_ACCEPTANCE_ROLLBACK_REFUSED';
  END IF;
END;
$rollback_guard$;

DELETE FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid;
DELETE FROM public.purchase_invoice_items WHERE id = '${fixture.itemId}'::uuid;
DELETE FROM public.purchase_invoices WHERE id = '${fixture.invoiceId}'::uuid;
DELETE FROM public.products WHERE id = '${fixture.productId}'::uuid;

UPDATE public.company_settings
SET enable_tax = false, tax_rate = 0
WHERE enable_tax IS TRUE AND tax_rate = 14
  AND purchase_tax_account_id = (SELECT id FROM public.accounts WHERE code = '1105')
  AND sales_tax_account_id = (SELECT id FROM public.accounts WHERE code = '2104');

DO $rollback_postcheck$
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE id = '${fixture.productId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.purchase_invoices WHERE id = '${fixture.invoiceId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.purchase_invoice_items WHERE id = '${fixture.itemId}'::uuid)
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE id = '${fixture.movementId}'::uuid)
     OR NOT EXISTS (SELECT 1 FROM public.company_settings WHERE enable_tax IS FALSE AND tax_rate = 0) THEN
    RAISE EXCEPTION 'STAGING_TAX_PURCHASE_ACCEPTANCE_ROLLBACK_POSTCHECK_FAILED';
  END IF;
END;
$rollback_postcheck$;
SELECT jsonb_build_object(
  'result', 'STAGING_TAX_PURCHASE_ACCEPTANCE_FIXTURE_ROLLBACK_OK',
  'source_id', '${fixture.invoiceId}'
) AS fixture_rollback;
COMMIT;
`;

export const stateSql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
WITH diagnostic_row AS (
  SELECT value AS row
  FROM jsonb_array_elements(public.get_inventory_reconciliation_diagnostic(
    'sources', true, '${fixture.invoiceId}', 500, 0, NULL
  )->'rows')
  WHERE value->>'source_type' = 'purchase_invoice'
    AND value->>'source_id' = '${fixture.invoiceId}'
  LIMIT 1
)
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'settings', (SELECT jsonb_build_object(
    'enable_tax', s.enable_tax, 'tax_rate', s.tax_rate,
    'purchase_code', p.code, 'sales_code', v.code
  ) FROM public.company_settings s
    JOIN public.accounts p ON p.id = s.purchase_tax_account_id
    JOIN public.accounts v ON v.id = s.sales_tax_account_id
    ORDER BY s.created_at LIMIT 1),
  'product', (SELECT jsonb_build_object(
    'id', p.id, 'code', p.code, 'quantity', p.quantity_on_hand, 'purchase_price', p.purchase_price
  ) FROM public.products p WHERE p.id = '${fixture.productId}'::uuid),
  'invoice', (SELECT jsonb_build_object(
    'id', i.id, 'invoice_number', i.invoice_number, 'status', i.status,
    'subtotal', i.subtotal, 'discount', i.discount, 'tax', i.tax, 'total', i.total,
    'journal_entry_id', i.journal_entry_id, 'notes', i.notes
  ) FROM public.purchase_invoices i WHERE i.id = '${fixture.invoiceId}'::uuid),
  'item_count', (SELECT count(*) FROM public.purchase_invoice_items WHERE id = '${fixture.itemId}'::uuid),
  'movement', (SELECT jsonb_build_object(
    'movement_type', m.movement_type, 'quantity', m.quantity, 'unit_cost', m.unit_cost,
    'total_cost', m.total_cost, 'reference_type', m.reference_type
  ) FROM public.inventory_movements m WHERE m.id = '${fixture.movementId}'::uuid),
  'repair_count', (SELECT count(*) FROM public.inventory_reconciliation_repair_items
    WHERE source_type = 'purchase_invoice' AND source_id = '${fixture.invoiceId}'::uuid),
  'diagnostic_row', (SELECT row FROM diagnostic_row),
  'plan', public.get_inventory_reconciliation_journal_plan(
    'purchase_invoice', '${fixture.invoiceId}'::uuid, NULL
  ),
  'counts', jsonb_build_object(
    'products', (SELECT count(*) FROM public.products),
    'purchase_invoices', (SELECT count(*) FROM public.purchase_invoices),
    'inventory_movements', (SELECT count(*) FROM public.inventory_movements),
    'journal_entries', (SELECT count(*) FROM public.journal_entries),
    'journal_entry_lines', (SELECT count(*) FROM public.journal_entry_lines),
    'repairs', (SELECT count(*) FROM public.inventory_reconciliation_repairs)
  )
) AS tax_purchase_acceptance_state;
ROLLBACK;
`;

export function validateAppliedState(state, baseline) {
  const failures = [];
  const settings = state?.settings;
  const invoice = state?.invoice;
  const product = state?.product;
  const movement = state?.movement;
  const row = state?.diagnostic_row;
  const plan = state?.plan;
  const lines = plan?.correction_lines ?? [];
  const line = (code) => lines.find((entry) => entry.account_code === code);

  if (state?.database !== "postgres" || !state?.server_version?.startsWith("17.")) failures.push("database_identity");
  if (!settings || settings.enable_tax !== true || Number(settings.tax_rate) !== 14
      || settings.purchase_code !== "1105" || settings.sales_code !== "2104") failures.push("tax_settings");
  if (!product || product.code !== fixture.productCode || Number(product.quantity) !== 2 || Number(product.purchase_price) !== 50) failures.push("product");
  if (!invoice || Number(invoice.invoice_number) !== fixture.invoiceNumber || invoice.status !== "posted"
      || Number(invoice.subtotal) !== 100 || Number(invoice.tax) !== 14 || Number(invoice.total) !== 114
      || invoice.journal_entry_id !== null || invoice.notes !== "__TAX_PURCHASE_ACCEPTANCE_WITHOUT_JOURNAL__") failures.push("invoice");
  if (Number(state?.item_count) !== 1 || !movement || movement.movement_type !== "purchase"
      || Number(movement.quantity) !== 2 || Number(movement.total_cost) !== 100
      || movement.reference_type !== "purchase_invoice") failures.push("stock_evidence");
  if (Number(state?.repair_count) !== 0) failures.push("unexpected_repair");
  if (!row || row.classification !== "movement_without_journal" || Number(row.movement_book_value) !== 100) failures.push("diagnostic");
  if (!plan || plan.eligible !== true || plan.reason_code !== "READY" || plan.mode !== "create_full_journal"
      || lines.length !== 3
      || Number(line("1104")?.debit) !== 100 || Number(line("1104")?.credit) !== 0
      || Number(line("1105")?.debit) !== 14 || Number(line("1105")?.credit) !== 0
      || Number(line("2101")?.debit) !== 0 || Number(line("2101")?.credit) !== 114) failures.push("journal_plan");
  if (Number(state?.counts?.products) !== Number(baseline?.counts?.products) + 1
      || Number(state?.counts?.purchase_invoices) !== Number(baseline?.counts?.purchase_invoices) + 1
      || Number(state?.counts?.inventory_movements) !== Number(baseline?.counts?.inventory_movements) + 1
      || Number(state?.counts?.journal_entries) !== Number(baseline?.counts?.journal_entries)
      || Number(state?.counts?.journal_entry_lines) !== Number(baseline?.counts?.journal_entry_lines)
      || Number(state?.counts?.repairs) !== Number(baseline?.counts?.repairs)) failures.push("controlled_counts");
  if (failures.length > 0) throw new Error(`حالة قبول الشراء الضريبي غير سليمة: ${failures.join(",")}`);
  return state;
}

function main() {
  const mode = process.argv[2];
  if (!["--apply", "--rollback"].includes(mode) || process.argv.length !== 3) {
    throw new Error("استخدم --apply أو --rollback");
  }
  assertStagingLink();
  process.umask(0o077);
  const reportDir = mkdtempSync(`/tmp/accounting-staging-tax-purchase-${mode.slice(2)}-`);
  chmodSync(reportDir, 0o700);
  writeFileSync(join(reportDir, "explicit-rollback.sql"), explicitRollbackSql, { mode: 0o600 });
  const expected = validateBaseline(JSON.parse(readFileSync(join(baselineDir, "baseline.json"), "utf8")));

  if (mode === "--apply") {
    const before = validateBaseline(extractNamedPayload(
      runCli(baselineSql, "baseline-before", reportDir), "tax_purchase_acceptance_baseline",
    ));
    assertSameBaseline(before, expected, "قبل التطبيق", reportDir);
    const applied = extractNamedPayload(runCli(applySql, "apply", reportDir), "fixture_apply");
    if (applied?.result !== "STAGING_TAX_PURCHASE_ACCEPTANCE_FIXTURE_READY") {
      throw new Error(`لم تعد عملية التطبيق علامة النجاح: ${reportDir}`);
    }
    const state = validateAppliedState(extractNamedPayload(
      runCli(stateSql, "post-apply-verification", reportDir), "tax_purchase_acceptance_state",
    ), expected);
    writeFileSync(join(reportDir, "report.json"), `${JSON.stringify({
      ...applied,
      state,
      explicitRollbackPrepared: true,
      productionModified: false,
      verifiedAt: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 });
    console.log("تم إنشاء حالة فاتورة الشراء الضريبية PUR-990023 على Staging والتحقق منها");
    console.log("الضريبة مفعلة بنسبة 14%، والمخطط متوازن على 1104 و1105 و2101، ولم يُنشأ قيد بعد");
  } else {
    validateAppliedState(extractNamedPayload(
      runCli(stateSql, "pre-rollback-verification", reportDir), "tax_purchase_acceptance_state",
    ), expected);
    const rolledBack = extractNamedPayload(runCli(explicitRollbackSql, "rollback", reportDir), "fixture_rollback");
    if (rolledBack?.result !== "STAGING_TAX_PURCHASE_ACCEPTANCE_FIXTURE_ROLLBACK_OK") {
      throw new Error(`لم يعد الرجوع علامة النجاح: ${reportDir}`);
    }
    const after = validateBaseline(extractNamedPayload(
      runCli(baselineSql, "baseline-after", reportDir), "tax_purchase_acceptance_baseline",
    ));
    assertSameBaseline(after, expected, "بعد الرجوع", reportDir);
    writeFileSync(join(reportDir, "report.json"), `${JSON.stringify({
      ...rolledBack,
      baselineRestored: true,
      productionModified: false,
      verifiedAt: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 });
    console.log("تم الرجوع عن حالة فاتورة الشراء الضريبية وعاد خط أساس Staging بالكامل");
  }
  console.log(`SOURCE=purchase_invoice:${fixture.invoiceNumber}`);
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
