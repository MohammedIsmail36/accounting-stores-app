// Run base and hardening contracts against the fixed offline L3 container.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (name) => readFileSync(join(root, name), "utf8");

function docker(args, input) {
  const result = spawnSync("docker", args, {
    input, encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || "فشل فحص L3");
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
  assert.equal(process.argv.length, 2, "لا يقبل المشغل أهدافًا أو خيارات خارجية");
  assertIsolation(JSON.parse(docker(["inspect", container]))[0]);
  const before = psql(fingerprint);
  const accounts = read("supabase/migrations/20260921213000_inventory_reconciliation_system_accounts.sql");
  const numbering = read("supabase/migrations/20260923030000_journal_posted_number_invariant.sql")
    .replace(/^BEGIN;\s*/m, "").replace(/^COMMIT;\s*/m, "");
  const base = read("supabase/migrations/20260924100000_inventory_atomic_variance_engine.sql");
  const hardening = read("supabase/migrations/20260924101000_inventory_atomic_variance_hardening.sql");
  const baseContract = read("supabase/tests/inventory_atomic_variance_engine_contract.sql")
    .replace("INVENTORY_VARIANCE_REVERSAL_NEGATIVE_STOCK",
      "INVENTORY_VARIANCE_PRECONDITION_CHANGED")
    .replace(/ROLLBACK;\s*$/, "");
  const hardeningContract = read("supabase/tests/inventory_atomic_variance_hardening_contract.sql");
  for (const source of [accounts, numbering, base, hardening, baseContract, hardeningContract]) {
    assert.doesNotMatch(source, /(?:farida|alibea)-db|\\connect\b|https?:\/\//i);
  }
  assert.match(baseContract, /current_database\(\) <> 'l3_public_restore'/);
  assert.match(hardeningContract, /ROLLBACK;\s*$/);
  const output = psql(`\\set ON_ERROR_STOP on\nBEGIN;\n${accounts}\n${numbering}\n${base}\n${hardening}\n${baseContract}\n${hardeningContract}`);
  assert.match(output, /INVENTORY_ATOMIC_VARIANCE_HARDENING_OK/);
  assert.equal(psql(fingerprint), before, "تغيرت بيانات L3 بعد التجربة");
  console.log("INVENTORY_ATOMIC_VARIANCE_HARDENING_OK: اجتاز المحرك والحراسة الاختبارات داخل L3");
  console.log("عادت بيانات L3 إلى خط الأساس؛ لم تتغير Staging أو أي بيئة إنتاجية");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
