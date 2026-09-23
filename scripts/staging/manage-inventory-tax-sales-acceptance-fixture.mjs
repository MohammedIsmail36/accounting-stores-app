// Controlled Staging-only taxed-sale fixture. The rollback refuses an active repair.
import { isDeepStrictEqual } from "node:util";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baselineSql, extract, fixture, validateBaseline } from "./backup-inventory-tax-sales-acceptance-baseline.mjs";
import { rehearsalSql } from "./rehearse-inventory-tax-sales-acceptance.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRef = "dunzfxurefzlaamgghys";
const archive = "/backups/staging/inventory-tax-sales-acceptance-before-20260923-145639";
const cli = "supabase@2.116.0";

const rollbackStart = rehearsalSql.indexOf("\nDO $explicit_rollback$\n");
const resultStart = rehearsalSql.indexOf("\nSELECT jsonb_build_object('result', 'STAGING_TAX_SALES_ACCEPTANCE_REHEARSAL_OK'", rollbackStart);
if (rollbackStart < 0 || resultStart < 0) throw new Error("تعذر فصل إعداد حالة البيع عن رجوعها الصريح");

export const applySql = `${rehearsalSql.slice(0, rollbackStart)}
SELECT jsonb_build_object('result', 'STAGING_TAX_SALES_ACCEPTANCE_FIXTURE_READY',
  'source_type', 'sales_invoice', 'source_id', '${fixture.invoiceId}',
  'invoice_number', ${fixture.invoiceNumber}, 'product_code', '${fixture.productCode}') AS tax_sales_fixture;
COMMIT;
`;

export const explicitRollbackSql = `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
${rehearsalSql.slice(rollbackStart, resultStart)}
SELECT jsonb_build_object('result', 'STAGING_TAX_SALES_ACCEPTANCE_FIXTURE_ROLLBACK_OK',
  'source_id', '${fixture.invoiceId}') AS tax_sales_fixture;
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
    throw new Error(`فشلت خطوة ${label} لحالة البيع الضريبي؛ التشخيص: ${logPath}`);
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
  const deltas = { accounts: 0, products: 1, inventory_movements: 2, sales_invoices: 1,
    sales_invoice_items: 1, purchase_invoices: 0, journal_entries: 1, journal_entry_lines: 2,
    repairs: 0, repair_items: 0, repair_effects: 0, repair_events: 0 };
  if (actual?.database !== "postgres" || actual?.project_ref !== projectRef || !actual?.server_version?.startsWith("17.")) failures.push("database_identity");
  if (!isDeepStrictEqual(actual?.tax_settings, expected?.tax_settings)) failures.push("tax_settings");
  for (const [key, delta] of Object.entries(deltas)) {
    if (Number(actual?.counts?.[key]) !== Number(expected?.counts?.[key]) + delta) failures.push(`count_${key}`);
  }
  const conflicts = actual?.fixture_conflicts;
  if (Number(conflicts?.products) !== 1 || Number(conflicts?.invoices) !== 1
      || Number(conflicts?.items) !== 1 || Number(conflicts?.movements) !== 2
      || Number(conflicts?.repairs) !== 0) failures.push("fixture_identity");
  for (const key of ["accounts", "settings", "purchase_invoices", "repairs", "repair_items", "repair_effects", "repair_events"]) {
    if (actual?.signatures?.[key] !== expected?.signatures?.[key]) failures.push(`signature_${key}`);
  }
  if (Number(actual?.diagnostic?.issue_counts?.sources) !== Number(expected?.diagnostic?.issue_counts?.sources) + 1
      || Number(actual?.diagnostic?.issue_counts?.products) !== Number(expected?.diagnostic?.issue_counts?.products)) failures.push("diagnostic");
  if (failures.length) throw new Error(`حالة البيع الضريبي بعد الإعداد غير سليمة: ${failures.join(",")}`);
  return actual;
}

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--apply", "--rollback"].includes(mode) || process.argv.length > 3) {
    throw new Error("استخدم --check أو --apply أو --rollback");
  }
  assertStaging();
  process.umask(0o077);
  const dir = mkdtempSync(`/tmp/accounting-staging-tax-sales-${mode.slice(2)}-`);
  chmodSync(dir, 0o700);
  writeFileSync(join(dir, "explicit-rollback.sql"), explicitRollbackSql, { mode: 0o600 });
  if (mode === "--check") {
    console.log("حالة البيع الضريبي وملف رجوعها جاهزان؛ لم تُكتب أي بيانات");
    console.log(`REPORT_DIR=${dir}`);
    return;
  }
  const expected = validateBaseline(JSON.parse(readFileSync(join(archive, "baseline.json"), "utf8")));
  const before = extract(runCli(baselineSql, "baseline-before", dir), "tax_sales_acceptance_baseline");
  if (mode === "--apply") sameBaseline(validateBaseline(before), expected, dir);
  else validateApplied(before, expected);

  const result = extract(runCli(mode === "--apply" ? applySql : explicitRollbackSql, mode.slice(2), dir), "tax_sales_fixture");
  const expectedResult = mode === "--apply" ? "STAGING_TAX_SALES_ACCEPTANCE_FIXTURE_READY" : "STAGING_TAX_SALES_ACCEPTANCE_FIXTURE_ROLLBACK_OK";
  if (result?.result !== expectedResult) throw new Error(`علامة تنفيذ الحالة غير صحيحة: ${dir}`);

  const after = extract(runCli(baselineSql, "baseline-after", dir), "tax_sales_acceptance_baseline");
  if (mode === "--apply") validateApplied(after, expected);
  else sameBaseline(validateBaseline(after), expected, dir);
  writeFileSync(join(dir, "report.json"), `${JSON.stringify({ ...result, mode, projectRef,
    baselineRestored: mode === "--rollback", productionModified: false, verifiedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  console.log(mode === "--apply" ? "أُنشئت حالة بيع ضريبية مضبوطة على Staging وتحقق خط الأساس بعد الإعداد"
    : "أُزيلت حالة البيع الضريبي المضبوطة وعاد خط أساس Staging بالكامل");
  console.log(`SOURCE=sales_invoice:${fixture.invoiceNumber}`);
  console.log(`REPORT_DIR=${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
