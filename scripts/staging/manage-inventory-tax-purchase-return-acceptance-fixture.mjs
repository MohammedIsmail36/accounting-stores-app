// Controlled Staging-only taxed purchase-return fixture and guarded business rollback.
import { isDeepStrictEqual } from "node:util";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baselineSql, extract, fixture, validateBaseline } from "./backup-inventory-tax-purchase-return-acceptance-baseline.mjs";
import { rehearsalSql } from "./rehearse-inventory-tax-purchase-return-acceptance.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRef = "dunzfxurefzlaamgghys";
const archive = "/backups/staging/inventory-tax-purchase-return-before-20260924-033335";
const cli = "supabase@2.116.0";

const rollbackStart = rehearsalSql.indexOf("\nDO $explicit_rollback$\n");
const resultStart = rehearsalSql.indexOf("\nSELECT jsonb_build_object('result', 'STAGING_TAX_PURCHASE_RETURN_REHEARSAL_OK'", rollbackStart);
if (rollbackStart < 0 || resultStart < 0) throw new Error("تعذر فصل إعداد مرتجع الشراء عن رجوعه الصريح");

export const applySql = `${rehearsalSql.slice(0, rollbackStart)}
SELECT jsonb_build_object('result', 'STAGING_TAX_PURCHASE_RETURN_FIXTURE_READY',
  'source_type', 'purchase_return', 'source_id', '${fixture.returnId}',
  'return_number', ${fixture.returnNumber}) AS purchase_return_fixture;
COMMIT;
`;

export const explicitRollbackSql = `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
${rehearsalSql.slice(rollbackStart, resultStart)}
SELECT jsonb_build_object('result', 'STAGING_TAX_PURCHASE_RETURN_FIXTURE_ROLLBACK_OK',
  'source_id', '${fixture.returnId}') AS purchase_return_fixture;
COMMIT;
`;

function assertStaging() {
  if (readFileSync(join(root, "supabase/.temp/project-ref"), "utf8").trim() !== projectRef) {
    throw new Error("المشروع المرتبط ليس Staging المعتمد");
  }
}

function cliEnvironment() {
  if (process.getuid?.() === 0 && process.env.SUDO_USER !== "deploy") throw new Error("استخدم sudo من حساب deploy فقط");
  const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
  if (!token) throw new Error("جلسة Supabase غير موجودة");
  return { ...process.env, ...(process.getuid?.() === 0 ? { HOME: "/home/deploy" } : {}), SUPABASE_ACCESS_TOKEN: token };
}

function runCli(sql, label, dir) {
  assertStaging();
  const sqlPath = join(dir, `${label}.sql`);
  const logPath = join(dir, `${label}.log`);
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  const result = spawnSync("npx", ["-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", sqlPath], {
    cwd: root, env: cliEnvironment(), encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n`, { mode: 0o600 });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    throw new Error(`فشلت خطوة ${label} لمرتجع الشراء؛ التشخيص: ${logPath}`);
  }
  return JSON.parse(result.stdout);
}

function normalize(value) {
  const copy = structuredClone(value);
  if (copy?.diagnostic) delete copy.diagnostic.snapshot_at;
  return copy;
}

function sameBaseline(actual, expected, dir) {
  if (!isDeepStrictEqual(normalize(actual), normalize(expected))) {
    writeFileSync(join(dir, "baseline-mismatch.json"), `${JSON.stringify({ expected, actual }, null, 2)}\n`, { mode: 0o600 });
    throw new Error("تغير خط أساس Staging؛ أُلغي الإجراء");
  }
}

export function validateApplied(actual, expected) {
  const failures = [];
  const deltas = { accounts: 0, settings: 0, products: 0, inventory_movements: 1,
    sales_invoices: 0, sales_returns: 0, purchase_invoices: 0, purchase_returns: 1,
    purchase_return_items: 1, journal_entries: 0, journal_entry_lines: 0,
    repairs: 0, repair_items: 0, repair_effects: 0, repair_events: 0 };
  if (actual?.database !== "postgres" || actual?.project_ref !== projectRef || !actual?.server_version?.startsWith("17.")) failures.push("database_identity");
  if (!isDeepStrictEqual(actual?.tax_settings, expected?.tax_settings)
      || !isDeepStrictEqual(actual?.source_invoice, expected?.source_invoice)) failures.push("source_or_settings");
  if (actual?.source_product?.id !== fixture.productId || Number(actual?.source_product?.quantity) !== 1
      || Number(actual?.source_product?.purchase_price) !== 50) failures.push("product_quantity");
  for (const [key, delta] of Object.entries(deltas)) {
    if (Number(actual?.counts?.[key]) !== Number(expected?.counts?.[key]) + delta) failures.push(`count_${key}`);
  }
  const conflicts = actual?.fixture_conflicts;
  if (Number(conflicts?.returns) !== 1 || Number(conflicts?.items) !== 1
      || Number(conflicts?.movements) !== 1 || Number(conflicts?.repairs) !== 0
      || Number(actual?.existing_source_returns) !== 1) failures.push("fixture_identity");
  for (const key of ["accounts", "settings", "sales_invoices", "sales_returns", "purchase_invoices",
    "journal_entries", "journal_entry_lines", "repairs", "repair_items", "repair_effects", "repair_events"]) {
    if (actual?.signatures?.[key] !== expected?.signatures?.[key]) failures.push(`signature_${key}`);
  }
  if (Number(actual?.diagnostic?.issue_counts?.sources) !== Number(expected?.diagnostic?.issue_counts?.sources) + 1
      || Number(actual?.diagnostic?.issue_counts?.products) !== Number(expected?.diagnostic?.issue_counts?.products)) failures.push("diagnostic");
  if (failures.length) throw new Error(`حالة مرتجع الشراء بعد الإعداد غير سليمة: ${failures.join(",")}`);
  return actual;
}

export function validateBusinessRollback(actual, expected) {
  const failures = [];
  if (actual?.database !== "postgres" || actual?.project_ref !== projectRef
      || Number(actual?.source_product?.quantity) !== 2
      || !isDeepStrictEqual(actual?.tax_settings, expected?.tax_settings)
      || !isDeepStrictEqual(actual?.source_invoice, expected?.source_invoice)) failures.push("source_or_settings");
  for (const [key, count] of Object.entries(expected?.counts ?? {})) {
    if (Number(actual?.counts?.[key]) !== Number(count)) failures.push(`count_${key}`);
  }
  if (Object.values(actual?.fixture_conflicts ?? {}).some((count) => Number(count) !== 0)
      || Number(actual?.existing_source_returns) !== 0) failures.push("fixture_remaining");
  for (const key of ["accounts", "settings", "sales_invoices", "sales_returns", "purchase_invoices",
    "purchase_returns", "purchase_return_items", "inventory_movements", "journal_entries", "journal_entry_lines",
    "repairs", "repair_items", "repair_effects", "repair_events"]) {
    if (actual?.signatures?.[key] !== expected?.signatures?.[key]) failures.push(`signature_${key}`);
  }
  if (Number(actual?.diagnostic?.issue_counts?.sources) !== Number(expected?.diagnostic?.issue_counts?.sources)
      || Number(actual?.diagnostic?.issue_counts?.products) !== Number(expected?.diagnostic?.issue_counts?.products)) failures.push("diagnostic");
  if (failures.length) throw new Error(`رجوع مرتجع الشراء لم يعِد حالة الأعمال: ${failures.join(",")}`);
  return actual;
}

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--apply", "--rollback"].includes(mode) || process.argv.length > 3) {
    throw new Error("استخدم --check أو --apply أو --rollback");
  }
  assertStaging();
  process.umask(0o077);
  const dir = mkdtempSync(`/tmp/accounting-staging-tax-purchase-return-${mode.slice(2)}-`);
  chmodSync(dir, 0o700);
  writeFileSync(join(dir, "explicit-rollback.sql"), explicitRollbackSql, { mode: 0o600 });
  if (mode === "--check") {
    console.log("حالة مرتجع الشراء الضريبي وملف رجوع أعمالها جاهزان؛ لم تُكتب بيانات");
    console.log("الرجوع لا يمحو سجل التدقيق أو وقت تعديل المنتج؛ النسخة الشاملة محفوظة منفصلة");
    console.log(`REPORT_DIR=${dir}`);
    return;
  }
  const expected = validateBaseline(JSON.parse(readFileSync(join(archive, "baseline.json"), "utf8")));
  const before = extract(runCli(baselineSql, "baseline-before", dir), "purchase_return_acceptance_baseline");
  if (mode === "--apply") sameBaseline(validateBaseline(before), expected, dir);
  else validateApplied(before, expected);
  const result = extract(runCli(mode === "--apply" ? applySql : explicitRollbackSql, mode.slice(2), dir), "purchase_return_fixture");
  const marker = mode === "--apply" ? "STAGING_TAX_PURCHASE_RETURN_FIXTURE_READY" : "STAGING_TAX_PURCHASE_RETURN_FIXTURE_ROLLBACK_OK";
  if (result?.result !== marker) throw new Error(`علامة الحالة غير صحيحة: ${dir}`);
  const after = extract(runCli(baselineSql, "baseline-after", dir), "purchase_return_acceptance_baseline");
  if (mode === "--apply") validateApplied(after, expected);
  else validateBusinessRollback(after, expected);
  writeFileSync(join(dir, "report.json"), `${JSON.stringify({ ...result, mode, projectRef,
    businessBaselineRestored: mode === "--rollback", auditHistoryRetained: true,
    productionModified: false, verifiedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  console.log(mode === "--apply" ? "أُنشئ مرتجع شراء ضريبي مضبوط على Staging وتحقق خط الأساس بعد الإعداد"
    : "حُذف المرتجع التجريبي وعاد رصيد الأعمال؛ بقي سجل التدقيق ووقت التعديل");
  console.log(`SOURCE=purchase_return:${fixture.returnNumber}`);
  console.log(`REPORT_DIR=${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
