// Read-only Staging backup before the controlled inventory-surplus acceptance.
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture as shortage } from "./backup-inventory-adjustment-shortage-baseline.mjs";
import { baselineSql as shortageBaselineSql, extract } from "./backup-inventory-adjustment-shortage-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRef = "dunzfxurefzlaamgghys";
const cli = "supabase@2.116.0";

export const fixture = Object.freeze({
  adjustmentId: "9d9d0000-0000-4000-8000-000000000901",
  itemId: "9d9d0000-0000-4000-8000-000000000902",
  movementId: "9d9d0000-0000-4000-8000-000000000903",
  adjustmentNumber: 990029,
  productId: shortage.productId,
  priorShortageId: shortage.adjustmentId,
});

const shortageAccount = "WHERE a.code IN ('1104', '5201')";
const anchor = "  'fixture_conflicts', jsonb_build_object(";
if (!shortageBaselineSql.includes(shortageAccount) || !shortageBaselineSql.includes(anchor)) {
  throw new Error("تعذر بناء خط أساس الفائض من عقد التسوية المعتمد");
}

export const baselineSql = shortageBaselineSql
  .replaceAll(shortage.adjustmentId, fixture.adjustmentId)
  .replaceAll(shortage.itemId, fixture.itemId)
  .replaceAll(shortage.movementId, fixture.movementId)
  .replaceAll(String(shortage.adjustmentNumber), String(fixture.adjustmentNumber))
  .replace(shortageAccount, "WHERE a.code IN ('1104', '4201')")
  .replace(anchor, `  'prior_shortage', (SELECT jsonb_build_object('id', a.id,
    'adjustment_number', a.adjustment_number, 'status', a.status,
    'journal_id', a.journal_entry_id, 'journal_status', j.status,
    'journal_posted_number', j.posted_number)
    FROM public.inventory_adjustments a LEFT JOIN public.journal_entries j ON j.id = a.journal_entry_id
    WHERE a.id = '${fixture.priorShortageId}'::uuid),
${anchor}`)
  .replace("adjustment_shortage_baseline;", "adjustment_surplus_baseline;");

export { extract };

export function validateBaseline(value) {
  const failures = [];
  if (value?.database !== "postgres" || value?.project_ref !== projectRef || !value?.server_version?.startsWith("17.")) failures.push("database_identity");
  if (Object.keys(value?.migration_state ?? {}).length !== 5
      || Object.values(value.migration_state).some((present) => present !== true)) failures.push("migrations");
  const stock = value?.account_map?.["1104"];
  const gain = value?.account_map?.["4201"];
  if (!stock || stock.active !== true || stock.parent !== false || stock.system !== true || stock.type !== "asset"
      || !gain || gain.active !== true || gain.parent !== false || gain.system !== true
      || gain.type !== "revenue" || gain.parent_code !== "4") failures.push("account_map");
  if (value?.source_product?.id !== fixture.productId || value?.source_product?.code !== "TST-TAX-SI-001"
      || Number(value?.source_product?.quantity) !== 9 || Number(value?.source_product?.purchase_price) !== 40
      || Number(value?.stock_movement?.signed_quantity) !== 9
      || Number(value?.stock_movement?.signed_value) !== 360) failures.push("source_inventory");
  if (value?.prior_shortage?.id !== fixture.priorShortageId
      || Number(value.prior_shortage.adjustment_number) !== shortage.adjustmentNumber
      || value.prior_shortage.status !== "posted" || value.prior_shortage.journal_status !== "posted"
      || Number(value.prior_shortage.journal_posted_number) !== 321) failures.push("prior_shortage");
  if (Object.keys(value?.fixture_conflicts ?? {}).length !== 4
      || Object.values(value.fixture_conflicts).some((count) => Number(count) !== 0)) failures.push("fixture_conflicts");
  if (failures.length) throw new Error(`خط أساس تسوية الفائض غير آمن: ${failures.join(",")}`);
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
    throw new Error(`فشل نسخ Staging قبل تسوية الفائض؛ التشخيص: ${logPath}`);
  }
  return result.stdout;
}

function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStaging();
  process.umask(0o077);
  const dir = mkdtempSync("/tmp/staging-inventory-adjustment-surplus-before-");
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
  const value = validateBaseline(extract(runCli(["db", "query", "--linked", "--output-format", "json", "--file", query], log), "adjustment_surplus_baseline"));
  writeFileSync(baselinePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  const files = [schema, data, query, baselinePath];
  writeFileSync(manifestPath, `${JSON.stringify({ result: "STAGING_ADJUSTMENT_SURPLUS_BASELINE_OK", projectRef,
    createdAt: new Date().toISOString(), readOnly: true, fixture,
    files: Object.fromEntries(files.map((path) => [path.split("/").at(-1), { bytes: statSync(path).size, sha256: sha256(path) }])) }, null, 2)}\n`, { mode: 0o600 });
  const sums = join(dir, "SHA256SUMS");
  writeFileSync(sums, `${[...files, manifestPath].map((path) => `${sha256(path)}  ${path.split("/").at(-1)}`).join("\n")}\n`, { mode: 0o600 });
  console.log("تم إنشاء نسخة Staging وخط أساس تسوية الفائض للقراءة فقط");
  console.log(`SOURCE_DIR=${dir}`);
  console.log(`COUNTS=${JSON.stringify(value.counts)}`);
  console.log(`PRODUCT=${JSON.stringify(value.source_product)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
