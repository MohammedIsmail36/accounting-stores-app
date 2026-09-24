// Controlled Staging-only surplus fixture and guarded business rollback.
import { isDeepStrictEqual } from "node:util";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baselineSql, extract, fixture, validateBaseline } from "./backup-inventory-adjustment-surplus-baseline.mjs";
import { rehearsalSql } from "./rehearse-inventory-adjustment-surplus.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRef = "dunzfxurefzlaamgghys";
const archive = "/backups/staging/inventory-adjustment-surplus-before-20260924-044842";
const cli = "supabase@2.116.0";

const rollbackStart = rehearsalSql.indexOf("\nDO $explicit_rollback$\n");
const resultStart = rehearsalSql.indexOf("\nSELECT jsonb_build_object('result', 'STAGING_ADJUSTMENT_SURPLUS_REHEARSAL_OK'", rollbackStart);
if (rollbackStart < 0 || resultStart < 0) throw new Error("تعذر فصل إعداد حالة الفائض عن الرجوع الصريح");

export const applySql = `${rehearsalSql.slice(0, rollbackStart)}
SELECT jsonb_build_object('result', 'STAGING_ADJUSTMENT_SURPLUS_FIXTURE_READY',
  'source_type', 'adjustment', 'source_id', '${fixture.adjustmentId}',
  'adjustment_number', ${fixture.adjustmentNumber}) AS adjustment_surplus_fixture;
COMMIT;
`;

export const explicitRollbackSql = `BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
${rehearsalSql.slice(rollbackStart, resultStart)}
SELECT jsonb_build_object('result', 'STAGING_ADJUSTMENT_SURPLUS_FIXTURE_ROLLBACK_OK',
  'source_id', '${fixture.adjustmentId}') AS adjustment_surplus_fixture;
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
    throw new Error(`فشلت خطوة ${label} لحالة فائض المخزون؛ التشخيص: ${logPath}`);
  }
  return JSON.parse(result.stdout);
}

function normalized(value) {
  const copy = structuredClone(value);
  if (copy?.diagnostic) delete copy.diagnostic.snapshot_at;
  return copy;
}

function sameBaseline(actual, expected, dir) {
  if (!isDeepStrictEqual(normalized(actual), normalized(expected))) {
    writeFileSync(join(dir, "baseline-mismatch.json"), `${JSON.stringify({ expected, actual }, null, 2)}\n`, { mode: 0o600 });
    throw new Error("تغير خط أساس Staging؛ أُلغي الإجراء");
  }
}

export function validateApplied(actual, expected) {
  const failures = [];
  const deltas = { accounts: 0, settings: 0, products: 0, inventory_movements: 1,
    inventory_adjustments: 1, inventory_adjustment_items: 1,
    sales_invoices: 0, sales_returns: 0, purchase_invoices: 0, purchase_returns: 0,
    journal_entries: 0, journal_entry_lines: 0,
    repairs: 0, repair_items: 0, repair_effects: 0, repair_events: 0 };
  if (actual?.database !== "postgres" || actual?.project_ref !== projectRef || !actual?.server_version?.startsWith("17.")) failures.push("database_identity");
  if (!isDeepStrictEqual(actual?.account_map, expected?.account_map)
      || !isDeepStrictEqual(actual?.prior_shortage, expected?.prior_shortage)
      || !isDeepStrictEqual(actual?.prior_sale, expected?.prior_sale)
      || !isDeepStrictEqual(actual?.prior_return, expected?.prior_return)) failures.push("accounts_or_prior_sources");
  if (actual?.source_product?.id !== fixture.productId || Number(actual?.source_product?.quantity) !== 10
      || Number(actual?.source_product?.purchase_price) !== 40
      || Number(actual?.stock_movement?.signed_quantity) !== 10
      || Number(actual?.stock_movement?.signed_value) !== 400) failures.push("product_and_movements");
  for (const [key, delta] of Object.entries(deltas)) {
    if (Number(actual?.counts?.[key]) !== Number(expected?.counts?.[key]) + delta) failures.push(`count_${key}`);
  }
  const conflicts = actual?.fixture_conflicts;
  if (Number(conflicts?.adjustments) !== 1 || Number(conflicts?.items) !== 1
      || Number(conflicts?.movements) !== 1 || Number(conflicts?.repairs) !== 0) failures.push("fixture_identity");
  for (const key of ["accounts", "settings", "sales_invoices", "sales_returns", "purchase_invoices", "purchase_returns",
    "journal_entries", "journal_entry_lines", "repairs", "repair_items", "repair_effects", "repair_events"]) {
    if (actual?.signatures?.[key] !== expected?.signatures?.[key]) failures.push(`signature_${key}`);
  }
  if (Number(actual?.diagnostic?.issue_counts?.sources) !== Number(expected?.diagnostic?.issue_counts?.sources) + 1
      || Number(actual?.diagnostic?.issue_counts?.products) !== Number(expected?.diagnostic?.issue_counts?.products)) failures.push("diagnostic");
  if (failures.length) throw new Error(`حالة فائض المخزون بعد الإعداد غير سليمة: ${failures.join(",")}`);
  return actual;
}

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--apply"].includes(mode) || process.argv.length > 3) {
    throw new Error("استخدم --check أو --apply؛ الرجوع يتطلب مراجعة مستقلة قبل أي حذف");
  }
  assertStaging();
  process.umask(0o077);
  const dir = mkdtempSync(`/tmp/accounting-staging-adjustment-surplus-${mode.slice(2)}-`);
  chmodSync(dir, 0o700);
  writeFileSync(join(dir, "explicit-rollback.sql"), explicitRollbackSql, { mode: 0o600 });
  if (mode === "--check") {
    console.log("حالة الفائض وملف رجوعها المشروط جاهزان؛ لم تُكتب بيانات");
    console.log("الرجوع لا يمحو سجل التدقيق أو وقت تعديل المنتج؛ النسخة الشاملة محفوظة منفصلة");
    console.log(`REPORT_DIR=${dir}`);
    return;
  }
  const expected = validateBaseline(JSON.parse(readFileSync(join(archive, "baseline.json"), "utf8")));
  const before = validateBaseline(extract(runCli(baselineSql, "baseline-before", dir), "adjustment_surplus_baseline"));
  sameBaseline(before, expected, dir);
  const result = extract(runCli(applySql, "apply", dir), "adjustment_surplus_fixture");
  if (result?.result !== "STAGING_ADJUSTMENT_SURPLUS_FIXTURE_READY") throw new Error(`علامة الحالة غير صحيحة: ${dir}`);
  const after = extract(runCli(baselineSql, "baseline-after", dir), "adjustment_surplus_baseline");
  validateApplied(after, expected);
  writeFileSync(join(dir, "report.json"), `${JSON.stringify({ ...result, mode, projectRef,
    productionModified: false, verifiedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  console.log("أُنشئت تسوية فائض تجريبية بلا قيد على Staging وتحقق خط الأساس بعد الإعداد");
  console.log(`SOURCE=adjustment:${fixture.adjustmentNumber}`);
  console.log(`REPORT_DIR=${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
