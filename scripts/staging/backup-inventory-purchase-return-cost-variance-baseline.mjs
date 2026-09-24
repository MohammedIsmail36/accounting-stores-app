// Read-only Staging backup before the purchase-return cost-variance acceptance.
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baselineSql as previousBaselineSql, extract, fixture as previousFixture } from "./backup-inventory-tax-purchase-return-acceptance-baseline.mjs";

export { extract };

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRef = "dunzfxurefzlaamgghys";
const cli = "supabase@2.116.0";

export const fixture = Object.freeze({
  returnId: "7d7d0000-0000-4000-8000-000000000701",
  itemId: "7d7d0000-0000-4000-8000-000000000702",
  movementId: "7d7d0000-0000-4000-8000-000000000703",
  returnNumber: 990027,
  sourceInvoiceId: previousFixture.sourceInvoiceId,
  productId: previousFixture.productId,
  priorReturnId: previousFixture.returnId,
});

function replaceRequired(source, from, to) {
  if (!source.includes(from)) throw new Error(`تعذر تكييف استعلام خط الأساس: ${from}`);
  return source.replaceAll(from, to);
}

const priorReturnClause = `'existing_source_returns', (SELECT count(*) FROM public.purchase_returns WHERE purchase_invoice_id = '${fixture.sourceInvoiceId}'::uuid),`;
export const baselineSql = replaceRequired(
  replaceRequired(
    replaceRequired(
      replaceRequired(previousBaselineSql, previousFixture.returnId, fixture.returnId),
      previousFixture.itemId, fixture.itemId),
    previousFixture.movementId, fixture.movementId),
  `return_number = ${previousFixture.returnNumber}`, `return_number = ${fixture.returnNumber}`
).replace(priorReturnClause, `${priorReturnClause}\n  'prior_return', (SELECT jsonb_build_object('id', r.id, 'status', r.status,
    'return_number', r.return_number, 'journal_entry_id', r.journal_entry_id, 'journal_status', j.status)
    FROM public.purchase_returns r LEFT JOIN public.journal_entries j ON j.id = r.journal_entry_id
    WHERE r.id = '${fixture.priorReturnId}'::uuid),`);
if (!baselineSql.includes("'prior_return'")) throw new Error("تعذر إضافة حارس المرتجع السابق");

export function validateBaseline(value) {
  const failures = [];
  if (value?.database !== "postgres" || value?.project_ref !== projectRef || !value?.server_version?.startsWith("17.")) failures.push("database_identity");
  if (Object.keys(value?.migration_state ?? {}).length !== 6 || Object.values(value.migration_state).some((present) => present !== true)) failures.push("migrations");
  if (Number(value?.settings_count) !== 1 || value?.tax_settings?.enable_tax !== true || Number(value?.tax_settings?.tax_rate) !== 14
      || value?.tax_settings?.purchase_code !== "1105" || value?.tax_settings?.sales_code !== "2104") failures.push("tax_settings");
  if (value?.source_invoice?.id !== fixture.sourceInvoiceId || Number(value?.source_invoice?.invoice_number) !== 990023
      || value?.source_invoice?.status !== "posted" || value?.source_invoice?.journal_status !== "posted"
      || !value?.source_invoice?.journal_entry_id || Number(value?.source_invoice?.total) !== 114) failures.push("source_invoice");
  if (value?.prior_return?.id !== fixture.priorReturnId || Number(value?.prior_return?.return_number) !== 990026
      || value?.prior_return?.status !== "posted" || value?.prior_return?.journal_status !== "posted"
      || !value?.prior_return?.journal_entry_id || Number(value?.existing_source_returns) !== 1) failures.push("prior_return");
  if (value?.source_product?.id !== fixture.productId || value?.source_product?.code !== "TST-TAX-PI-001"
      || Number(value?.source_product?.quantity) !== 1 || Number(value?.source_product?.purchase_price) !== 50
      || Number(value?.source_movement?.quantity) !== 2 || Number(value?.source_movement?.total_cost) !== 100) failures.push("source_inventory");
  if (Object.keys(value?.fixture_conflicts ?? {}).length !== 4
      || Object.values(value.fixture_conflicts).some((count) => Number(count) !== 0)) failures.push("fixture_conflicts");
  if (failures.length) throw new Error(`خط أساس فرق تكلفة مرتجع الشراء غير آمن: ${failures.join(",")}`);
  return value;
}

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

function runCli(args, logPath) {
  assertStaging();
  const result = spawnSync("npx", ["-y", cli, ...args], {
    cwd: root, env: cliEnvironment(), encoding: "utf8", timeout: 300000, maxBuffer: 96 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\n`, { mode: 0o600 });
    throw new Error(`فشل نسخ Staging قبل فرق تكلفة مرتجع الشراء؛ التشخيص: ${logPath}`);
  }
  return result.stdout;
}

function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStaging();
  process.umask(0o077);
  const dir = mkdtempSync("/tmp/staging-inventory-purchase-return-variance-before-");
  chmodSync(dir, 0o700);
  const schema = join(dir, "public-schema.sql");
  const data = join(dir, "public-data.sql");
  const query = join(dir, "baseline-query.sql");
  const baselinePath = join(dir, "baseline.json");
  const manifestPath = join(dir, "manifest.json");
  const log = join(dir, "run.log");
  writeFileSync(query, baselineSql, { mode: 0o600 });
  runCli(["db", "dump", "--linked", "--schema", "public", "--file", schema], log);
  runCli(["db", "dump", "--linked", "--schema", "public", "--data-only", "--use-copy", "--file", data], log);
  chmodSync(schema, 0o600); chmodSync(data, 0o600);
  if (statSync(schema).size < 10_000 || statSync(data).size < 10_000) throw new Error("نسخة Staging غير مكتملة");
  const value = validateBaseline(extract(runCli(["db", "query", "--linked", "--output-format", "json", "--file", query], log), "purchase_return_acceptance_baseline"));
  writeFileSync(baselinePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  const files = [schema, data, query, baselinePath];
  writeFileSync(manifestPath, `${JSON.stringify({ result: "STAGING_PURCHASE_RETURN_VARIANCE_BASELINE_OK", projectRef,
    createdAt: new Date().toISOString(), readOnly: true, fixture,
    files: Object.fromEntries(files.map((path) => [path.split("/").at(-1), { bytes: statSync(path).size, sha256: sha256(path) }])) }, null, 2)}\n`, { mode: 0o600 });
  const sums = join(dir, "SHA256SUMS");
  writeFileSync(sums, `${[...files, manifestPath].map((path) => `${sha256(path)}  ${path.split("/").at(-1)}`).join("\n")}\n`, { mode: 0o600 });
  console.log("تم إنشاء نسخة Staging وخط أساس فرق تكلفة مرتجع الشراء للقراءة فقط");
  console.log(`SOURCE_DIR=${dir}`);
  console.log(`COUNTS=${JSON.stringify(value.counts)}`);
  console.log(`TAX_SETTINGS=${JSON.stringify(value.tax_settings)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
