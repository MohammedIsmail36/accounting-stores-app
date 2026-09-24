// Public-schema Staging snapshot for the Phase 3 atomic inventory-adjustment gate.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRef = "dunzfxurefzlaamgghys";
const cli = "supabase@2.116.0";
const baselineQuery = join(root, "scripts/staging/inventory-atomic-variance-baseline.sql");
const versions = ["20260924100000", "20260924101000", "20260924102000", "20260924103000", "20260924104000"];

export function assertStagingLink() {
  if (readFileSync(join(root, "supabase/.temp/project-ref"), "utf8").trim() !== projectRef) {
    throw new Error("رُفض النسخ: الرابط ليس مشروع Staging المعتمد");
  }
}

function cliEnv() {
  if (process.getuid?.() !== 0) return process.env;
  if (process.env.SUDO_USER !== "deploy") throw new Error("يُسمح باستخدام sudo من حساب deploy فقط");
  const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
  if (!token) throw new Error("جلسة Supabase غير متاحة");
  return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: token };
}

function runCli(args, logPath) {
  assertStagingLink();
  const result = spawnSync("npx", ["-y", cli, ...args], {
    cwd: root, env: cliEnv(), encoding: "utf8", timeout: 300_000,
    maxBuffer: 96 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\n`, { mode: 0o600 });
    throw new Error(`فشل فحص Staging أو النسخ؛ التشخيص المحمي: ${logPath}`);
  }
  return result.stdout;
}

function extractPayload(output) {
  const parsed = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1));
  const value = parsed?.rows?.find((row) => row.inventory_atomic_baseline)?.inventory_atomic_baseline;
  if (!value) throw new Error("خط الأساس غير موجود في نتيجة الاستعلام");
  return value;
}

export function stableBaseline(value) {
  return {
    database: value?.database,
    server_version: value?.server_version,
    migration_versions: value?.migration_versions,
    engine_exists: value?.engine_exists,
    counts: value?.counts,
    signatures: value?.signatures,
    diagnostic: {
      fingerprint: value?.diagnostic?.fingerprint,
      status: value?.diagnostic?.status,
      totals: value?.diagnostic?.totals,
      issue_counts: value?.diagnostic?.issue_counts,
    },
  };
}

export function validateBaseline(value) {
  if (value?.database !== "postgres" || !value?.server_version?.startsWith("17.")) {
    throw new Error("هوية قاعدة Staging أو إصدارها غير متوقعين");
  }
  if (!Array.isArray(value.migration_versions) || value.migration_versions.some((v) => versions.includes(v))
      || value.engine_exists) throw new Error("إحدى ترحيلات المحرك مطبقة بالفعل؛ توقف");
  if (value?.diagnostic?.status !== "rounding_only"
      || Number(value?.diagnostic?.totals?.movement_to_ledger_difference) !== 0.02
      || Number(value?.diagnostic?.totals?.quantity_difference) !== 0
      || Number(value?.diagnostic?.totals?.unlinked_journal_count) !== 0
      || Number(value?.diagnostic?.totals?.unlinked_movement_count) !== 0) {
    throw new Error("تشخيص المخزون اختلف عن خط الأساس المتفق عليه؛ توقف");
  }
  return value;
}

export function queryState(logPath) {
  return extractPayload(runCli(
    ["db", "query", "--linked", "--output-format", "json", "--file", baselineQuery], logPath,
  ));
}

export function queryBaseline(logPath) {
  return validateBaseline(queryState(logPath));
}

function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStagingLink();
  process.umask(0o077);
  const archive = mkdtempSync("/backups/staging/inventory-atomic-variance-before-");
  chmodSync(archive, 0o700);
  const log = join(archive, "run.log");
  const before = queryBaseline(log);
  const schema = join(archive, "public-schema.sql");
  const data = join(archive, "public-data.sql");
  runCli(["db", "dump", "--linked", "--schema", "public", "--file", schema], log);
  runCli(["db", "dump", "--linked", "--schema", "public", "--data-only", "--use-copy", "--file", data], log);
  chmodSync(schema, 0o600);
  chmodSync(data, 0o600);
  if (statSync(schema).size < 10_000 || statSync(data).size < 10_000) {
    throw new Error("نسخة public غير مكتملة");
  }
  const after = queryBaseline(log);
  if (JSON.stringify(stableBaseline(before)) !== JSON.stringify(stableBaseline(after))) {
    throw new Error("تغيرت بيانات Staging أثناء النسخ؛ لا تعتمد هذه النسخة");
  }
  const queryCopy = join(archive, "baseline-query.sql");
  const baseline = join(archive, "baseline.json");
  writeFileSync(queryCopy, readFileSync(baselineQuery), { mode: 0o600 });
  writeFileSync(baseline, `${JSON.stringify(after, null, 2)}\n`, { mode: 0o600 });
  const files = [schema, data, queryCopy, baseline];
  const manifest = join(archive, "manifest.json");
  writeFileSync(manifest, `${JSON.stringify({
    result: "STAGING_ATOMIC_VARIANCE_BASELINE_OK", projectRef,
    createdAt: new Date().toISOString(), scope: "public schema and data",
    files: Object.fromEntries(files.map((path) => [path.split("/").at(-1), { bytes: statSync(path).size, sha256: sha256(path) }])),
  }, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(archive, "SHA256SUMS"), `${[...files, manifest]
    .map((path) => `${sha256(path)}  ${path.split("/").at(-1)}`).join("\n")}\n`, { mode: 0o600 });
  console.log("تم حفظ نسخة public من Staging والتحقق من ثبات خط الأساس والبصمات");
  console.log(`ARCHIVE_DIR=${archive}`);
  console.log(`COUNTS=${JSON.stringify(after.counts)}`);
  console.log(`ROUNDING_DIFFERENCE=${after.diagnostic.totals.movement_to_ledger_difference}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
