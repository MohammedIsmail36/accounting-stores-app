// Read-only outcome probe: every attempted write is enclosed in a transaction
// that is rolled back against the already-isolated L3 public-schema restore.
import { spawnSync } from "node:child_process";

const container = "854444943e9790aab117a5e4639e8b23e448441673d45340b259abd9ba532a22";
const database = "l3_public_restore";

function docker(args, input) {
  return spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 1024 * 1024 });
}

function assertIsolation() {
  const inspected = docker(["inspect", container]);
  if (inspected.status !== 0) throw new Error("L3 container unavailable");
  const info = JSON.parse(inspected.stdout)[0];
  if (info.Id !== container || info.Name !== "/accounting-l3-restore-20260909"
    || !info.State.Running || info.Config.Labels?.["accounting.purpose"] !== "l3-restore-test"
    || info.HostConfig.NetworkMode !== "none" || !info.HostConfig.ReadonlyRootfs
    || info.HostConfig.Privileged || (info.HostConfig.Binds ?? []).length
    || (info.Mounts ?? []).length || Object.keys(info.HostConfig.PortBindings ?? {}).length) {
    throw new Error("L3 isolation identity mismatch; no SQL attempted");
  }
}

function psql(sql) {
  return docker([
    "exec", "-i", container, "psql", "-h", "/tmp", "-U", "postgres", "-d", database,
    "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1",
  ], sql);
}

function query(sql) {
  const result = psql(`BEGIN READ ONLY;\n${sql}\nROLLBACK;`);
  if (result.status !== 0) throw new Error(`L3 metadata check failed: ${result.stderr}`);
  return result.stdout.trim();
}

assertIsolation();
const identity = query(`SELECT current_database() || '|' || current_setting('server_version') || '|'
  || (SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public') || '|'
  || (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname='public'
      AND tablename IN ('customer_payments','supplier_payments','customer_payment_allocations',
        'supplier_payment_allocations','sales_return_payment_allocations',
        'purchase_return_payment_allocations')) || '|'
  || (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname='service_role' AND rolbypassrls);`);
if (identity !== "l3_public_restore|17.6|39|21|0") {
  throw new Error(`Unexpected L3 schema/role baseline: ${identity}`);
}

const stateSql = `SELECT
  (SELECT count(*) FROM public.customer_payments WHERE status='posted') || '|'
  || (SELECT count(*) FROM public.supplier_payments WHERE status='posted') || '|'
  || (SELECT count(*) FROM public.customer_payment_allocations) || '|'
  || (SELECT count(*) FROM public.supplier_payment_allocations) || '|'
  || (SELECT count(*) FROM public.sales_return_payment_allocations) || '|'
  || (SELECT count(*) FROM public.purchase_return_payment_allocations) || '|'
  || (SELECT count(*) FROM public.user_roles WHERE role='sales') || '|'
  || (SELECT count(*) FROM public.user_roles WHERE role='accountant') || '|'
  || (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.customer_payments t) || '|'
  || (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.supplier_payments t) || '|'
  || (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.customer_payment_allocations t) || '|'
  || (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.supplier_payment_allocations t) || '|'
  || (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.sales_return_payment_allocations t) || '|'
  || (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.purchase_return_payment_allocations t) || '|'
  || (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.user_roles t) || '|'
  || (SELECT pg_get_functiondef('auth.uid()'::regprocedure) LIKE '%SELECT NULL::uuid%');`;
const before = query(stateSql);
if (!before.endsWith("|true")) throw new Error("L3 auth fixture is not the expected NULL stub");

const cases = [
  ["customer_cancel_status", "UPDATE public.customer_payments SET status='cancelled' WHERE id=(SELECT id FROM public.customer_payments WHERE status='posted' ORDER BY id LIMIT 1)", ["admin", "accountant", "sales", "anon", "service_role", "postgres"]],
  ["supplier_cancel_status", "UPDATE public.supplier_payments SET status='cancelled' WHERE id=(SELECT id FROM public.supplier_payments WHERE status='posted' ORDER BY id LIMIT 1)", ["admin", "accountant", "sales", "service_role", "postgres"]],
  ["customer_unlink_journal", "UPDATE public.customer_payments SET journal_entry_id=NULL WHERE id=(SELECT id FROM public.customer_payments WHERE status='posted' AND journal_entry_id IS NOT NULL ORDER BY id LIMIT 1)", ["admin", "accountant", "sales", "postgres"]],
  ["supplier_change_amount", "UPDATE public.supplier_payments SET amount=amount+1 WHERE id=(SELECT id FROM public.supplier_payments WHERE status='posted' ORDER BY id LIMIT 1)", ["admin", "accountant", "sales", "postgres"]],
  ["customer_allocation_delete", "DELETE FROM public.customer_payment_allocations WHERE id=(SELECT id FROM public.customer_payment_allocations ORDER BY id LIMIT 1)", ["admin", "accountant", "sales", "service_role", "postgres"]],
  ["supplier_allocation_delete", "DELETE FROM public.supplier_payment_allocations WHERE id=(SELECT id FROM public.supplier_payment_allocations ORDER BY id LIMIT 1)", ["admin", "accountant", "sales", "postgres"]],
  ["sales_return_allocation_delete", "DELETE FROM public.sales_return_payment_allocations WHERE id=(SELECT id FROM public.sales_return_payment_allocations ORDER BY id LIMIT 1)", ["admin", "accountant", "sales", "postgres"]],
  ["purchase_return_allocation_delete", "DELETE FROM public.purchase_return_payment_allocations WHERE id=(SELECT id FROM public.purchase_return_payment_allocations ORDER BY id LIMIT 1)", ["admin", "accountant", "sales", "postgres"]],
];
const expected = {
  customer_cancel_status: { admin: "1", accountant: "1", sales: "1", anon: "0", service_role: "0", postgres: "1" },
  supplier_cancel_status: { admin: "1", accountant: "1", sales: "0", service_role: "0", postgres: "1" },
  customer_unlink_journal: { admin: "1", accountant: "1", sales: "1", postgres: "1" },
  supplier_change_amount: { admin: "1", accountant: "1", sales: "0", postgres: "1" },
  customer_allocation_delete: { admin: "1", accountant: "1", sales: "0", service_role: "0", postgres: "1" },
  supplier_allocation_delete: { admin: "1", accountant: "1", sales: "0", postgres: "1" },
  sales_return_allocation_delete: { admin: "1", accountant: "1", sales: "0", postgres: "1" },
  purchase_return_allocation_delete: { admin: "1", accountant: "1", sales: "0", postgres: "1" },
};

function runCase(name, statement, role) {
  const claim = role === "admin" || role === "accountant" || role === "sales"
    ? `(SELECT user_id::text FROM public.user_roles WHERE role='${role}' LIMIT 1)`
    : `''`;
  const databaseRole = role === "admin" || role === "accountant" || role === "sales" ? "authenticated" : role;
  const sql = `BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS 'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
${role === "accountant" ? `UPDATE public.user_roles SET role='accountant' WHERE id=(SELECT id FROM public.user_roles WHERE role='sales' ORDER BY id LIMIT 1);` : ""}
SELECT set_config('request.jwt.claim.sub', ${claim}, true) IS NOT NULL;
SET LOCAL ROLE ${databaseRole};
WITH changed AS (${statement} RETURNING 1) SELECT count(*) FROM changed;
ROLLBACK;`;
  const result = psql(sql);
  if (result.status === 0) {
    const lines = result.stdout.trim().split("\n");
    const count = lines.at(-1);
    if (!/^[01]$/.test(count)) throw new Error(`Unexpected row count for ${name}/${role}`);
    return count;
  }
  const error = result.stderr.match(/ERROR:\s*([^\n]+)/)?.[1] ?? "unknown SQL error";
  return `ERROR:${error}`;
}

for (const [name, statement, roles] of cases) {
  const results = roles.map((role) => {
    const actual = runCase(name, statement, role);
    if (actual !== expected[name][role]) {
      throw new Error(`${name}/${role}: expected ${expected[name][role]}, got ${actual}`);
    }
    return `${role}=${actual}`;
  });
  process.stdout.write(`${name}: ${results.join(" ")}\n`);
}
const after = query(stateSql);
if (after !== before) throw new Error("L3 rows or auth fixture changed; stop and inspect isolation");
process.stdout.write("L3_FULL_PUBLIC_SCHEMA_ROLE_PROBE_OK; ALL_ATTEMPTED_WRITES_ROLLED_BACK\n");
process.stdout.write("LIMITATION: 2026-09-09 public snapshot; synthetic auth.uid; service_role has no BYPASSRLS; no HTTP/API claim\n");
