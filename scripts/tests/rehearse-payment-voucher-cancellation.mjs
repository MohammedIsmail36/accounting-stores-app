import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const fixture = readFileSync(resolve(root, "supabase/tests/payment_voucher_cancel_guard_fixture.sql"), "utf8");
const guard = readFileSync(
  resolve(root, "supabase/migrations/20260820030015_17eeaa1f-f061-4740-9db0-c2e9287be10b.sql"),
  "utf8",
);
const containerName = `accounting-stage1-voucher-${randomBytes(5).toString("hex")}`;

function docker(args, input) {
  return spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 1024 * 1024 });
}

function required(args, input) {
  const result = docker(args, input);
  if (result.status !== 0) {
    throw new Error(`Docker test step failed: ${args.slice(0, 3).join(" ")}\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function psql(sql, expectFailure = false) {
  const result = docker(
    ["exec", "-i", containerName, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
    sql,
  );
  if (expectFailure) {
    if (result.status === 0 || !String(result.stderr).includes("قيد آلي مولّد من عملية")) {
      throw new Error(`Expected system-journal guard rejection; got ${result.status}: ${result.stderr}`);
    }
    return;
  }
  if (result.status !== 0) throw new Error(`SQL test step failed: ${result.stderr}`);
  return result.stdout.trim();
}

const ids = {
  customer: { payment: "00000000-0000-4000-8000-000000000201", journal: "00000000-0000-4000-8000-000000000101" },
  supplier: { payment: "00000000-0000-4000-8000-000000000202", journal: "00000000-0000-4000-8000-000000000102" },
};

function snapshot(kind) {
  const { payment, journal } = ids[kind];
  const paymentTable = kind === "customer" ? "customer_payments" : "supplier_payments";
  const allocationTable = kind === "customer" ? "customer_payment_allocations" : "supplier_payment_allocations";
  const invoiceTable = kind === "customer" ? "sales_invoices" : "purchase_invoices";
  const partyTable = kind === "customer" ? "customers" : "suppliers";
  const sql = `SELECT json_build_object(
    'payment_status', (SELECT status FROM public.${paymentTable} WHERE id = '${payment}'),
    'journal_status', (SELECT status FROM public.journal_entries WHERE id = '${journal}'),
    'allocations', (SELECT count(*) FROM public.${allocationTable} WHERE payment_id = '${payment}'),
    'invoice_paid_amount', (SELECT paid_amount FROM public.${invoiceTable} LIMIT 1),
    'party_balance', (SELECT balance FROM public.${partyTable} LIMIT 1)
  );`;
  return JSON.parse(psql(sql));
}

function assertSame(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: ${JSON.stringify({ expected, actual })}`);
  }
}

let containerId;
try {
  containerId = required([
    "run", "--rm", "-d", "--pull", "never", "--network", "none", "--name", containerName,
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:15-alpine",
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (docker(["exec", containerName, "pg_isready", "-U", "postgres"]).status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready");

  psql(fixture);
  psql(guard);
  for (const kind of ["customer", "supplier"]) {
    const { payment, journal } = ids[kind];
    const allocationTable = kind === "customer" ? "customer_payment_allocations" : "supplier_payment_allocations";
    const before = snapshot(kind);
    if (before.payment_status !== "posted" || before.journal_status !== "posted" || before.allocations !== 1) {
      throw new Error(`${kind}: invalid synthetic baseline`);
    }

    // A single transaction rolls the allocation deletion back after the guard rejects the journal update.
    psql(`BEGIN; DELETE FROM public.${allocationTable} WHERE payment_id = '${payment}';
      UPDATE public.journal_entries SET status = 'cancelled' WHERE id = '${journal}'; COMMIT;`, true);
    assertSame(snapshot(kind), before, `${kind}: atomic rollback`);

    // The current client issues separate requests. The first deletion commits before the guarded update fails.
    psql(`DELETE FROM public.${allocationTable} WHERE payment_id = '${payment}';`);
    psql(`UPDATE public.journal_entries SET status = 'cancelled' WHERE id = '${journal}';`, true);
    const after = snapshot(kind);
    assertSame(after, { ...before, allocations: 0 }, `${kind}: expected partial state`);
    process.stdout.write(`${kind.toUpperCase()}_PARTIAL_CANCELLATION_REPRODUCED: allocation deleted; voucher and journal remain posted\n`);
  }
  process.stdout.write("DISPOSABLE_DB_ONLY; NO_STAGING_OR_PRODUCTION_WRITES\n");
} finally {
  if (containerId) {
    const stopped = docker(["stop", "--time", "2", containerId]);
    if (stopped.status !== 0) process.stderr.write(`Disposable container cleanup failed: ${containerId}\n`);
  }
}
