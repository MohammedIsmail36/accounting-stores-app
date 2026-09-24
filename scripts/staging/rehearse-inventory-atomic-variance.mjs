// Compile all Phase 3 migrations on Staging, then roll back the whole transaction.
// A second transaction checks their explicit rollback files without leaving changes.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStagingLink, queryBaseline, stableBaseline, validateBaseline } from "./backup-inventory-atomic-variance-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = "supabase@2.116.0";
export const names = [
  "20260924100000_inventory_atomic_variance_engine.sql",
  "20260924101000_inventory_atomic_variance_hardening.sql",
  "20260924102000_inventory_atomic_variance_zero_balance_guard.sql",
  "20260924103000_inventory_atomic_variance_write_guard.sql",
  "20260924104000_inventory_atomic_variance_diagnostic_compat.sql",
];

function hash(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function cliEnv() {
  if (process.getuid?.() !== 0) return process.env;
  if (process.env.SUDO_USER !== "deploy") throw new Error("يُسمح باستخدام sudo من حساب deploy فقط");
  const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
  if (!token) throw new Error("جلسة Supabase غير متاحة");
  return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: token };
}

export function runQuery(sql, label, dir) {
  const path = join(dir, `${label}.sql`);
  const log = join(dir, "run.log");
  writeFileSync(path, sql, { mode: 0o600 });
  assertStagingLink();
  const result = spawnSync("npx", ["-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", path], {
    cwd: root, env: cliEnv(), encoding: "utf8", timeout: 300_000,
    maxBuffer: 96 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    writeFileSync(log, `${label}\n${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\n`, { mode: 0o600 });
    throw new Error(`فشلت تجربة Staging (${label})؛ التشخيص المحمي: ${log}`);
  }
  return result.stdout;
}

function source(kind, name) {
  const path = join(root, "supabase", kind, name);
  const sql = readFileSync(path, "utf8");
  if (/\\connect\b|https?:\/\/|(?:farida|alibea)-db/i.test(sql)) {
    throw new Error(`مرجع خارجي غير متوقع في ${name}`);
  }
  return { path, sql };
}

export function stripOwnTransaction(sql) {
  return sql.replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, "");
}

export function sourceSql(kind, name) {
  const value = source(kind, name).sql;
  return name.includes("103000") || name.includes("104000")
    ? stripOwnTransaction(value) : value;
}

const identity = `DO $identity$
BEGIN
  IF current_database() <> 'postgres'
     OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
       WHERE version IN ('20260924100000','20260924101000','20260924102000','20260924103000','20260924104000'))
     OR to_regclass('public.inventory_variance_operations') IS NOT NULL
  THEN RAISE EXCEPTION 'STAGING_ATOMIC_VARIANCE_IDENTITY_MISMATCH'; END IF;
END $identity$;`;

export function beginSql() {
  return `BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '180s';\nSELECT set_config('request.jwt.claim.role', 'service_role', true);\n${identity}\n`;
}

function buildMigrationSql() {
  const migrations = names.map((name) => sourceSql("migrations", name)).join("\n");
  return `${beginSql()}
${migrations}
DO $verify$
DECLARE v_diagnostic jsonb;
BEGIN
  IF to_regclass('public.inventory_variance_operations') IS NULL
     OR to_regclass('public.inventory_variance_operation_lines') IS NULL
     OR to_regprocedure('public.post_inventory_adjustment_atomic(uuid,uuid)') IS NULL
     OR to_regprocedure('public.reverse_inventory_adjustment_atomic(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.fn_guard_inventory_adjustment_document()') IS NULL
     OR to_regprocedure('public.fn_guard_variance_zero_balance()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.inventory_adjustments'::regclass
         AND tgname = 'trg_guard_inventory_adjustment_document' AND NOT tgisinternal)
  THEN RAISE EXCEPTION 'STAGING_ATOMIC_VARIANCE_OBJECTS_MISSING'; END IF;
  SELECT public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)
    INTO v_diagnostic;
  IF v_diagnostic->>'status' <> 'rounding_only'
     OR (v_diagnostic->'totals'->>'movement_to_ledger_difference')::numeric <> 0.02
  THEN RAISE EXCEPTION 'STAGING_ATOMIC_VARIANCE_DIAGNOSTIC_CHANGED'; END IF;
END $verify$;
SELECT 'STAGING_ATOMIC_VARIANCE_MIGRATION_REHEARSAL_OK' AS result;
ROLLBACK;`;
}

function buildRollbackSql() {
  const migrations = names.map((name) => sourceSql("migrations", name)).join("\n");
  const rollback = names.toReversed().map((name) => {
    const version = name.slice(0, 14);
    return `SELECT set_config('app.inventory_variance_rollback_authorized','STAGING_${version}',true);
${sourceSql("rollback", name)}`;
  }).join("\n");
  return `${beginSql()}
CREATE TEMP TABLE atomic_variance_original_diagnostic ON COMMIT DROP AS
  SELECT md5(pg_get_functiondef('public.get_inventory_reconciliation_diagnostic(text,boolean,text,integer,integer,text)'::regprocedure)) AS definition_hash;
${migrations}
${rollback}
DO $verify$
BEGIN
  IF to_regclass('public.inventory_variance_operations') IS NOT NULL
     OR to_regclass('public.inventory_variance_operation_lines') IS NOT NULL
     OR to_regprocedure('public.post_inventory_adjustment_atomic(uuid,uuid)') IS NOT NULL
     OR to_regprocedure('public.reverse_inventory_adjustment_atomic(uuid,uuid,text)') IS NOT NULL
     OR to_regprocedure('public.fn_guard_inventory_adjustment_document()') IS NOT NULL
     OR (SELECT definition_hash FROM atomic_variance_original_diagnostic)
       <> md5(pg_get_functiondef('public.get_inventory_reconciliation_diagnostic(text,boolean,text,integer,integer,text)'::regprocedure))
  THEN RAISE EXCEPTION 'STAGING_ATOMIC_VARIANCE_EXPLICIT_ROLLBACK_INVALID'; END IF;
END $verify$;
SELECT 'STAGING_ATOMIC_VARIANCE_EXPLICIT_ROLLBACK_OK' AS result;
ROLLBACK;`;
}

function main() {
  if (process.argv.length !== 3) throw new Error("الاستخدام: node rehearse-inventory-atomic-variance.mjs ARCHIVE_DIR");
  assertStagingLink();
  const archive = realpathSync(process.argv[2]);
  if (!archive.startsWith("/backups/staging/inventory-atomic-variance-before-")) {
    throw new Error("مسار النسخة الاحتياطية غير متوقع");
  }
  const checksums = readFileSync(join(archive, "SHA256SUMS"), "utf8").trim().split("\n");
  for (const line of checksums) {
    const match = /^([a-f0-9]{64})  ([a-z.-]+)$/.exec(line);
    if (!match || hash(join(archive, match[2])) !== match[1]) {
      throw new Error("فشل التحقق من بصمة النسخة الاحتياطية");
    }
  }
  const expected = validateBaseline(JSON.parse(readFileSync(join(archive, "baseline.json"), "utf8")));
  process.umask(0o077);
  const dir = mkdtempSync(join(archive, "transactional-rehearsal-"));
  chmodSync(dir, 0o700);
  const log = join(dir, "run.log");
  const compare = (label) => {
    const actual = queryBaseline(log);
    if (JSON.stringify(stableBaseline(actual)) !== JSON.stringify(stableBaseline(expected))) {
      throw new Error(`تغير خط أساس Staging في ${label}؛ ألغيت التجربة`);
    }
  };
  compare("قبل التجربة");
  const migration = runQuery(buildMigrationSql(), "migration-rehearsal", dir);
  if (!migration.includes("STAGING_ATOMIC_VARIANCE_MIGRATION_REHEARSAL_OK")) {
    throw new Error("علامة نجاح تجربة الترحيل غير موجودة");
  }
  compare("بعد إلغاء معاملة الترحيل");
  const rollback = runQuery(buildRollbackSql(), "explicit-rollback-rehearsal", dir);
  if (!rollback.includes("STAGING_ATOMIC_VARIANCE_EXPLICIT_ROLLBACK_OK")) {
    throw new Error("علامة نجاح تجربة الرجوع غير موجودة");
  }
  compare("بعد إلغاء معاملة الرجوع");
  const paths = names.flatMap((name) => [source("migrations", name).path, source("rollback", name).path]);
  const report = join(dir, "report.json");
  writeFileSync(report, `${JSON.stringify({
    result: "STAGING_ATOMIC_VARIANCE_REHEARSAL_OK",
    archive, createdAt: new Date().toISOString(),
    migrationTransactionRolledBack: true,
    explicitRollbackTransactionRolledBack: true,
    baselineUnchanged: true,
    productionModified: false,
    sourceHashes: Object.fromEntries(paths.map((path) => [path.slice(root.length), hash(path)])),
  }, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(dir, "SHA256SUMS"), `${[join(dir, "migration-rehearsal.sql"), join(dir, "explicit-rollback-rehearsal.sql"), report]
    .map((path) => `${hash(path)}  ${path.split("/").at(-1)}`).join("\n")}\n`, { mode: 0o600 });
  console.log("نجحت تجربة ترحيلات محرك التسوية والرجوع الصريح على Staging داخل معاملتين انتهتا بـ ROLLBACK");
  console.log("تطابقت بيانات الأعمال والتشخيص مع خط الأساس؛ لم يُطبّق أي ترحيل تطبيقًا دائمًا");
  console.log(`REPORT_DIR=${dir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
