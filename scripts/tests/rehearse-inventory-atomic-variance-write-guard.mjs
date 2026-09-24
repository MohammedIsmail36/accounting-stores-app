// Offline L3-only cutover guard rehearsal. No hosted database is contacted.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (name) => readFileSync(join(root, name), "utf8");
const unwrap = (sql) => sql.replace(/^\s*BEGIN;\s*/, "").replace(/\s*COMMIT;\s*$/, "");

function docker(args, input) {
  const result = spawnSync("docker", args, {
    input, encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || "فشل اختبار L3");
  }
  return result.stdout.trim();
}

function psql(input) {
  return docker(["exec", "-i", container, "psql", "-h", "/tmp", "-U", "postgres",
    "-d", database, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"], input);
}

const fingerprint = `SELECT jsonb_build_object(
  'adjustments', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_adjustments x),
  'items', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_adjustment_items x),
  'products', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.products x),
  'movements', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_movements x),
  'journals', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.journal_entries x),
  'journal_lines', (SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.journal_entry_lines x)
);`;

try {
  const mode = process.argv[2] ?? "--run";
  assert.ok(["--run", "--test-explicit-rollback"].includes(mode) && process.argv.length <= 3);
  assertIsolation(JSON.parse(docker(["inspect", container]))[0]);
  const before = psql(fingerprint);
  const accounts = read("supabase/migrations/20260921213000_inventory_reconciliation_system_accounts.sql");
  const numbering = unwrap(read("supabase/migrations/20260923030000_journal_posted_number_invariant.sql"));
  const base = read("supabase/migrations/20260924100000_inventory_atomic_variance_engine.sql");
  const hardening = read("supabase/migrations/20260924101000_inventory_atomic_variance_hardening.sql");
  const precision = read("supabase/migrations/20260924102000_inventory_atomic_variance_zero_balance_guard.sql");
  const guard = unwrap(read("supabase/migrations/20260924103000_inventory_atomic_variance_write_guard.sql"));
  const contract = read("supabase/tests/inventory_atomic_variance_write_guard_contract.sql");
  const rollback = unwrap(read("supabase/rollback/20260924103000_inventory_atomic_variance_write_guard.sql"));
  const marker = mode === "--run"
    ? "INVENTORY_ATOMIC_VARIANCE_WRITE_GUARD_OK"
    : "INVENTORY_ATOMIC_VARIANCE_WRITE_GUARD_ROLLBACK_OK";
  const body = mode === "--run" ? contract : `
SELECT set_config('app.inventory_variance_rollback_authorized', 'STAGING_20260924103000', true);
${rollback}
SELECT CASE WHEN to_regprocedure('public.fn_guard_inventory_adjustment_document()') IS NULL
  AND has_function_privilege('authenticated', 'public.adjust_product_quantity(uuid,numeric)', 'EXECUTE')
  THEN 'INVENTORY_ATOMIC_VARIANCE_WRITE_GUARD_ROLLBACK_OK' ELSE 'ROLLBACK_FAILED' END;
ROLLBACK;`;
  for (const sql of [accounts, numbering, base, hardening, precision, guard, body]) {
    assert.doesNotMatch(sql, /(?:farida|alibea)-db|\\connect\b|https?:\/\//i,
      "ملف يتضمن هدفًا خارجيًا");
  }
  const output = psql(`\\set ON_ERROR_STOP on\nBEGIN;\n${accounts}\n${numbering}\n${base}\n${hardening}\n${precision}\n${guard}\n${body}`);
  assert.match(output, new RegExp(marker));
  assert.equal(psql(fingerprint), before, "تغيرت بيانات L3 بعد الاختبار");
  console.log(`${marker}: نجح اختبار حماية الكتابة داخل L3 مع ROLLBACK كامل`);
  console.log("لم تتغير L3 أو Staging أو الإنتاج");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
