import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const containerName = `accounting-voucher-rls-${randomBytes(5).toString("hex")}`;
const fixture = readFileSync(resolve(root, "supabase/tests/payment_voucher_rls_fixture.sql"), "utf8");
const sources = [
  "20260217132118_509849d3-a142-4081-b2d2-760f7eda79fc.sql",
  "20260217201111_24c6e460-a055-49af-a7ed-23b5dff85c68.sql",
  "20260313174130_959a783c-299f-482f-892c-1cda4f233910.sql",
];
const expectedPolicyCounts = {
  customer_payments: 4,
  supplier_payments: 4,
  customer_payment_allocations: 3,
  supplier_payment_allocations: 3,
  sales_return_payment_allocations: 3,
  purchase_return_payment_allocations: 3,
};

function actualSourcePolicies() {
  const counts = Object.fromEntries(Object.keys(expectedPolicyCounts).map((table) => [table, 0]));
  const statements = [];
  for (const name of sources) {
    const source = readFileSync(resolve(root, "supabase/migrations", name), "utf8");
    const pattern = /CREATE POLICY\s+"[^"]+"\s+ON public\.([a-z_]+)\s+FOR\s+(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]*?;/gi;
    for (const match of source.matchAll(pattern)) {
      if (!(match[1] in counts)) continue;
      counts[match[1]] += 1;
      statements.push(match[0]);
    }
  }
  if (Object.entries(expectedPolicyCounts).some(([table, count]) => counts[table] !== count)) {
    throw new Error(`Payment policy source changed; review extraction: ${JSON.stringify(counts)}`);
  }
  return statements.join("\n");
}

function docker(args, input) {
  return spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 1024 * 1024 });
}

function psql(sql, expectedFailure = false) {
  const result = docker(
    ["exec", "-i", containerName, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
    sql,
  );
  if (expectedFailure) {
    if (result.status === 0 || !String(result.stderr).includes("row-level security policy")) {
      throw new Error(`Expected RLS rejection, got ${result.status}: ${result.stderr || result.stdout}`);
    }
    return "RLS_REJECTED";
  }
  if (result.status !== 0) throw new Error(`SQL step failed: ${result.stderr}`);
  return result.stdout.trim();
}

const identities = {
  admin: "00000000-0000-4000-8000-000000000001",
  accountant: "00000000-0000-4000-8000-000000000002",
  sales: "00000000-0000-4000-8000-000000000003",
  anon: "",
};
const cases = [
  {
    name: "customer_cancel_status_direct",
    sql: "WITH changed AS (UPDATE public.customer_payments SET status='cancelled' RETURNING 1) SELECT count(*) FROM changed;",
    expected: { admin: "1", accountant: "1", sales: "1", anon: "0" },
  },
  {
    name: "supplier_cancel_status_direct",
    sql: "WITH changed AS (UPDATE public.supplier_payments SET status='cancelled' RETURNING 1) SELECT count(*) FROM changed;",
    expected: { admin: "1", accountant: "1", sales: "0", anon: "0" },
  },
  {
    name: "customer_repoint_original_journal_direct",
    sql: "WITH changed AS (UPDATE public.customer_payments SET journal_entry_id='00000000-0000-4000-8000-000000000399' RETURNING 1) SELECT count(*) FROM changed;",
    expected: { admin: "1", accountant: "1", sales: "1", anon: "0" },
  },
  {
    name: "supplier_change_posted_amount_direct",
    sql: "WITH changed AS (UPDATE public.supplier_payments SET amount=999 RETURNING 1) SELECT count(*) FROM changed;",
    expected: { admin: "1", accountant: "1", sales: "0", anon: "0" },
  },
  {
    name: "customer_delete_posted_direct",
    sql: "WITH changed AS (DELETE FROM public.customer_payments RETURNING 1) SELECT count(*) FROM changed;",
    expected: { admin: "1", accountant: "0", sales: "0", anon: "0" },
  },
  {
    name: "customer_allocation_delete_direct",
    sql: "WITH changed AS (DELETE FROM public.customer_payment_allocations RETURNING 1) SELECT count(*) FROM changed;",
    expected: { admin: "1", accountant: "1", sales: "0", anon: "0" },
  },
  {
    name: "supplier_allocation_delete_direct",
    sql: "WITH changed AS (DELETE FROM public.supplier_payment_allocations RETURNING 1) SELECT count(*) FROM changed;",
    expected: { admin: "1", accountant: "1", sales: "0", anon: "0" },
  },
  {
    name: "sales_return_allocation_delete_direct",
    sql: "WITH changed AS (DELETE FROM public.sales_return_payment_allocations RETURNING 1) SELECT count(*) FROM changed;",
    expected: { admin: "1", accountant: "1", sales: "0", anon: "0" },
  },
  {
    name: "purchase_return_allocation_delete_direct",
    sql: "WITH changed AS (DELETE FROM public.purchase_return_payment_allocations RETURNING 1) SELECT count(*) FROM changed;",
    expected: { admin: "1", accountant: "1", sales: "0", anon: "0" },
  },
  {
    name: "customer_allocation_insert_direct",
    sql: `WITH changed AS (INSERT INTO public.customer_payment_allocations VALUES
      ('00000000-0000-4000-8000-000000000299', '00000000-0000-4000-8000-000000000101',
       '00000000-0000-4000-8000-000000000499', 1) RETURNING 1) SELECT count(*) FROM changed;`,
    expected: { admin: "1", accountant: "1", sales: "1", anon: "RLS_REJECTED" },
  },
];

function runAs(role, statement, expected) {
  const databaseRole = role === "anon" ? "anon" : "authenticated";
  const sql = `BEGIN;
    SET LOCAL ROLE ${databaseRole};
    SET LOCAL request.jwt.claim.sub TO '${identities[role]}';
    ${statement}
    ROLLBACK;`;
  const actual = psql(sql, expected === "RLS_REJECTED");
  if (actual !== expected) throw new Error(`${role}: expected ${expected}, got ${actual}`);
}

let containerId;
try {
  const started = docker([
    "run", "--rm", "-d", "--pull", "never", "--network", "none", "--name", containerName,
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:15-alpine",
  ]);
  if (started.status !== 0) throw new Error(`Could not start disposable DB: ${started.stderr}`);
  containerId = started.stdout.trim();
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logs = docker(["logs", containerName]);
    if (
      String(logs.stdout + logs.stderr).includes("PostgreSQL init process complete") &&
      docker(["exec", containerName, "pg_isready", "-U", "postgres"]).status === 0
    ) {
      ready = true;
      break;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
  psql(fixture);
  psql(actualSourcePolicies());
  for (const scenario of cases) {
    for (const role of Object.keys(identities)) runAs(role, scenario.sql, scenario.expected[role]);
    process.stdout.write(`${scenario.name}: ${Object.entries(scenario.expected).map(([role, result]) => `${role}=${result}`).join(" ")}\n`);
  }
  const finalState = psql(`SELECT status || ':' || amount || ':' || journal_entry_id
    FROM public.customer_payments UNION ALL SELECT status || ':' || amount || ':' || journal_entry_id
    FROM public.supplier_payments ORDER BY 1;`);
  if (!finalState.includes("posted:100:") || !finalState.includes("posted:75:")) {
    throw new Error(`Test transactions changed the fixture: ${finalState}`);
  }
  process.stdout.write("PAYMENT_VOUCHER_SOURCE_RLS_REPRODUCED; DISPOSABLE_DB_ONLY; NO_STAGING_OR_PRODUCTION_WRITES\n");
} finally {
  if (containerId) {
    const stopped = docker(["stop", "--time", "2", containerId]);
    if (stopped.status !== 0) process.stderr.write(`Disposable container cleanup failed: ${containerId}\n`);
  }
}
