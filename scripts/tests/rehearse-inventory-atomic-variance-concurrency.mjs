// Concurrent requests against a disposable clone inside the fixed offline L3
// container. The clone is created by this script and dropped in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (name) => readFileSync(join(root, name), "utf8");
const clone = `l3_inventory_atomic_${process.pid}_${randomUUID().slice(0, 8)}`;
assert.match(clone, /^l3_inventory_atomic_[0-9]+_[0-9a-f]{8}$/);

function command(db, input) {
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-h", "/tmp",
    "-U", "postgres", "-d", db, "-X", "-q", "-A", "-t",
    "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    input, encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || "فشل أمر اختبار L3");
  }
  return result.stdout.trim();
}

function concurrent(db, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-h", "/tmp",
      "-U", "postgres", "-d", db, "-X", "-q", "-A", "-t",
      "-v", "ON_ERROR_STOP=1", "-f", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let error = "";
    child.stdout.setEncoding("utf8").on("data", part => { output += part; });
    child.stderr.setEncoding("utf8").on("data", part => { error += part; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output.trim())
      : reject(new Error(error.trim() || `psql exited ${code}`)));
    child.stdin.end(sql);
  });
}

const fixture = randomUUID();
const request = randomUUID();
let created = false;
try {
  assert.equal(process.argv.length, 2, "اختبار التزامن لا يقبل هدفًا خارجيًا");
  const inspected = spawnSync("docker", ["inspect", container], { encoding: "utf8" });
  if (inspected.status !== 0) throw new Error(inspected.stderr.trim());
  assertIsolation(JSON.parse(inspected.stdout)[0]);

  const sourceBefore = command(database, `SELECT json_build_object(
    'adjustments',(SELECT count(*) FROM public.inventory_adjustments),
    'movements',(SELECT count(*) FROM public.inventory_movements),
    'journals',(SELECT count(*) FROM public.journal_entries));`);
  command("postgres", `CREATE DATABASE ${clone} TEMPLATE ${database};`);
  created = true;

  const accounts = read("supabase/migrations/20260921213000_inventory_reconciliation_system_accounts.sql");
  const numbering = read("supabase/migrations/20260923030000_journal_posted_number_invariant.sql");
  const base = read("supabase/migrations/20260924100000_inventory_atomic_variance_engine.sql");
  const hardening = read("supabase/migrations/20260924101000_inventory_atomic_variance_hardening.sql");
  const precision = read("supabase/migrations/20260924102000_inventory_atomic_variance_zero_balance_guard.sql");
  for (const source of [accounts, numbering, base, hardening, precision]) {
    assert.doesNotMatch(source, /(?:farida|alibea)-db|\\connect\b|https?:\/\//i);
  }
  for (const migration of [accounts, numbering, base, hardening, precision]) {
    command(clone, `\\set ON_ERROR_STOP on\nBEGIN;\n${migration}\nCOMMIT;`);
  }
  command(clone, `CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
    AS $auth$ SELECT 'service_role'::text $auth$;
    INSERT INTO public.inventory_adjustments(id,adjustment_date,status)
    VALUES('${fixture}'::uuid,CURRENT_DATE,'draft');
    INSERT INTO public.inventory_adjustment_items(
      adjustment_id,product_id,system_quantity,actual_quantity,difference,notes
    ) SELECT '${fixture}'::uuid,id,quantity_on_hand,quantity_on_hand-1,-1,
      'اختبار طلبين متزامنين' FROM public.products WHERE code='PRD-497';`);

  const call = `\\set ON_ERROR_STOP on\nBEGIN;\nSELECT public.post_inventory_adjustment_atomic(
    '${fixture}'::uuid,'${request}'::uuid);\n`;
  const first = concurrent(clone, `${call}SELECT pg_sleep(1);\nCOMMIT;`);
  await new Promise(resolve => setTimeout(resolve, 100));
  const second = concurrent(clone, `${call}COMMIT;`);
  const outputs = await Promise.all([first, second]);
  const results = outputs.map(output => {
    const line = output.split("\n").find(value => value.startsWith("{"));
    if (!line) throw new Error(`نتيجة طلب التزامن غير متوقعة: ${output}`);
    return JSON.parse(line);
  });
  assert.deepEqual(results.map(value => value.repeated).sort(), [false, true]);
  assert.equal(results[0].operation_id, results[1].operation_id);

  const state = JSON.parse(command(clone, `SELECT json_build_object(
    'status',(SELECT status FROM public.inventory_adjustments WHERE id='${fixture}'::uuid),
    'operations',(SELECT count(*) FROM public.inventory_variance_operations WHERE source_id='${fixture}'::uuid),
    'movements',(SELECT count(*) FROM public.inventory_movements WHERE reference_id='${fixture}'::uuid),
    'journals',(SELECT count(*) FROM public.journal_entries
      WHERE id=(SELECT journal_entry_id FROM public.inventory_adjustments WHERE id='${fixture}'::uuid)),
    'lines',(SELECT count(*) FROM public.journal_entry_lines
      WHERE journal_entry_id=(SELECT journal_entry_id FROM public.inventory_adjustments WHERE id='${fixture}'::uuid))
  );`));
  assert.deepEqual(state, {
    status: "posted", operations: 1, movements: 1, journals: 1, lines: 2,
  });
  assert.equal(command(database, `SELECT json_build_object(
    'adjustments',(SELECT count(*) FROM public.inventory_adjustments),
    'movements',(SELECT count(*) FROM public.inventory_movements),
    'journals',(SELECT count(*) FROM public.journal_entries));`), sourceBefore);
  console.log("INVENTORY_ATOMIC_VARIANCE_CONCURRENCY_OK: طلبان متزامنان أنشآ حركة وقيدًا واحدين فقط");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      command("postgres", `DROP DATABASE ${clone} WITH (FORCE);`);
      console.log("حُذفت قاعدة الاختبار المؤقتة التي أنشأها هذا المشغل داخل L3");
    } catch (error) {
      console.error(`تعذر حذف قاعدة الاختبار المؤقتة ${clone}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
