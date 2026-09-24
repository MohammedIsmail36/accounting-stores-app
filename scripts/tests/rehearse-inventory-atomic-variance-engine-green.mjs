// Rehearse Phase 3 only inside the fixed, offline L3 database and roll it back.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (name) => readFileSync(join(root, name), "utf8");

function docker(args, input) {
  const run = spawnSync("docker", args, {
    input, encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (run.error || run.status !== 0) {
    throw new Error(run.stderr?.trim() || run.error?.message || "فشل فحص L3");
  }
  return run.stdout.trim();
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
  assert.equal(process.argv.length, 2, "هذا المشغل لا يقبل خيارات أو أهدافًا خارجية");
  assertIsolation(JSON.parse(docker(["inspect", container]))[0]);
  const before = psql(fingerprint);
  const accounts = read("supabase/migrations/20260921213000_inventory_reconciliation_system_accounts.sql");
  const numbering = read("supabase/migrations/20260923030000_journal_posted_number_invariant.sql")
    .replace(/^BEGIN;\s*/m, "").replace(/^COMMIT;\s*/m, "");
  const engine = read("supabase/migrations/20260924100000_inventory_atomic_variance_engine.sql");
  const contract = read("supabase/tests/inventory_atomic_variance_engine_contract.sql");
  assert.match(contract, /current_database\(\) <> 'l3_public_restore'/);
  assert.match(contract, /ROLLBACK;/);
  for (const source of [accounts, numbering, engine, contract]) {
    assert.doesNotMatch(source, /(?:farida|alibea)-db|\\connect\b|https?:\/\//i);
  }
  const output = psql(`\\set ON_ERROR_STOP on\nBEGIN;\n${accounts}\n${numbering}\n${engine}\n${contract}`);
  assert.match(output, /INVENTORY_ATOMIC_VARIANCE_CONTRACT_OK/);
  assert.equal(psql(fingerprint), before, "تغيرت بيانات L3 بعد الاختبار");
  console.log("INVENTORY_ATOMIC_VARIANCE_CONTRACT_OK: نجحت اختبارات المحرك ورجعت جميع البيانات في L3");
  console.log("لم تتغير Staging أو أي بيئة إنتاجية");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
