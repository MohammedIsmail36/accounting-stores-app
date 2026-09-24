// Final offline L3 runner for the three Phase 3 migrations and explicit rollback.
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
  const mode = process.argv[2] ?? "--run";
  assert.ok(["--run", "--test-explicit-rollback"].includes(mode)
    && process.argv.length <= 3, "استخدم --run أو --test-explicit-rollback");
  assertIsolation(JSON.parse(docker(["inspect", container]))[0]);
  const before = psql(fingerprint);
  const accounts = read("supabase/migrations/20260921213000_inventory_reconciliation_system_accounts.sql");
  const numbering = read("supabase/migrations/20260923030000_journal_posted_number_invariant.sql")
    .replace(/^BEGIN;\s*/m, "").replace(/^COMMIT;\s*/m, "");
  const base = read("supabase/migrations/20260924100000_inventory_atomic_variance_engine.sql");
  const hardening = read("supabase/migrations/20260924101000_inventory_atomic_variance_hardening.sql");
  const precision = read("supabase/migrations/20260924102000_inventory_atomic_variance_zero_balance_guard.sql");
  let body;
  let marker;

  if (mode === "--run") {
    const baseContract = read("supabase/tests/inventory_atomic_variance_engine_contract.sql")
      .replace("INVENTORY_VARIANCE_REVERSAL_NEGATIVE_STOCK",
        "INVENTORY_VARIANCE_PRECONDITION_CHANGED")
      .replace(/ROLLBACK;\s*$/, "");
    const hardeningContract = read("supabase/tests/inventory_atomic_variance_hardening_contract.sql")
      .replace(/ROLLBACK;\s*$/, "");
    const precisionContract = read("supabase/tests/inventory_atomic_variance_zero_balance_contract.sql");
    assert.match(baseContract, /current_database\(\) <> 'l3_public_restore'/);
    assert.match(precisionContract, /ROLLBACK;\s*$/);
    body = `${baseContract}\n${hardeningContract}\n${precisionContract}`;
    marker = "INVENTORY_ATOMIC_VARIANCE_ZERO_BALANCE_OK";
  } else {
    const zeroRollback = read("supabase/rollback/20260924102000_inventory_atomic_variance_zero_balance_guard.sql");
    const hardeningRollback = read("supabase/rollback/20260924101000_inventory_atomic_variance_hardening.sql");
    const baseRollback = read("supabase/rollback/20260924100000_inventory_atomic_variance_engine.sql");
    body = `SELECT set_config('app.inventory_variance_rollback_authorized','STAGING_20260924102000',true);
${zeroRollback}
SELECT set_config('app.inventory_variance_rollback_authorized','STAGING_20260924101000',true);
${hardeningRollback}
SELECT set_config('app.inventory_variance_rollback_authorized','STAGING_20260924100000',true);
${baseRollback}
SELECT CASE WHEN to_regclass('public.inventory_variance_operations') IS NULL
  AND to_regprocedure('public.post_inventory_adjustment_atomic(uuid,uuid)') IS NULL
  THEN 'INVENTORY_ATOMIC_VARIANCE_ROLLBACK_OK' ELSE 'ROLLBACK_FAILED' END;
ROLLBACK;`;
    marker = "INVENTORY_ATOMIC_VARIANCE_ROLLBACK_OK";
  }

  for (const source of [accounts, numbering, base, hardening, precision, body]) {
    assert.doesNotMatch(source, /(?:farida|alibea)-db|\\connect\b|https?:\/\//i,
      "ملف يتضمن هدفًا خارجيًا");
  }
  const output = psql(`\\set ON_ERROR_STOP on\nBEGIN;\n${accounts}\n${numbering}\n${base}\n${hardening}\n${precision}\n${body}`);
  assert.match(output, new RegExp(marker));
  assert.equal(psql(fingerprint), before, "تغيرت بيانات L3 بعد الاختبار");
  console.log(`${marker}: اكتمل الفحص داخل L3 مع ROLLBACK كامل`);
  console.log("لم تتغير بيانات L3 أو Staging أو أي بيئة إنتاجية");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
