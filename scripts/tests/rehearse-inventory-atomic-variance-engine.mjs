// Phase 3 isolation gate. The red mode makes no changes and checks that the
// new write path is absent before implementation.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";

const expectedFunctions = [
  "public.post_inventory_adjustment_atomic(uuid,uuid)",
  "public.reverse_inventory_adjustment_atomic(uuid,uuid,text)",
];

function docker(args, input) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || "فشل فحص L3");
  }
  return result.stdout.trim();
}

function query(sql) {
  return docker([
    "exec", "-i", container, "psql", "-h", "/tmp", "-U", "postgres",
    "-d", database, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-",
  ], sql);
}

const fingerprintSql = `SELECT jsonb_build_object(
  'adjustments', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_adjustments x),
  'items', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_adjustment_items x),
  'products', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.products x),
  'movements', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_movements x),
  'journals', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.journal_entries x),
  'journal_lines', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.journal_entry_lines x)
);`;

function main() {
  assert.equal(process.argv[2], "--expect-missing", "الوضع المتاح الآن: --expect-missing فقط");
  assert.equal(process.argv.length, 3);
  const inspected = JSON.parse(docker(["inspect", container]));
  assertIsolation(inspected[0]);
  const before = query(fingerprintSql);
  const result = query(`BEGIN;
DO $gate$
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'INVENTORY_ATOMIC_ENGINE_ISOLATION_FAILED';
  END IF;
  IF to_regprocedure('${expectedFunctions[0]}') IS NOT NULL
     OR to_regprocedure('${expectedFunctions[1]}') IS NOT NULL THEN
    RAISE EXCEPTION 'INVENTORY_ATOMIC_ENGINE_ALREADY_PRESENT';
  END IF;
END $gate$;
SELECT 'TDD_INVENTORY_ATOMIC_VARIANCE_RED_OK';
ROLLBACK;`);
  assert.match(result, /TDD_INVENTORY_ATOMIC_VARIANCE_RED_OK/);
  assert.equal(query(fingerprintSql), before, "تغيرت بيانات L3 أثناء فحص الغياب");
  console.log("TDD_INVENTORY_ATOMIC_VARIANCE_RED_OK: منفذا الترحيل والعكس غير موجودين كما هو متوقع");
  console.log("لم تتغير بيانات L3، ولم يحدث اتصال بـ Staging أو الإنتاج");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
