// Reproduce separate-request posting failures in a disposable, networkless PG15.
// Synthetic rows only; does not connect to Staging or either production database.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const fixture = readFileSync(resolve(root, "supabase/tests/payment_voucher_posting_partial_fixture.sql"), "utf8");
const name = `accounting-voucher-posting-${randomBytes(5).toString("hex")}`;
let containerId;

function docker(args, input) {
  return spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 1024 * 1024 });
}

function psql(sql, expectedConstraint) {
  const result = docker(
    ["exec", "-i", containerId, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
    sql,
  );
  if (expectedConstraint) {
    if (result.status === 0 || !result.stderr.includes(expectedConstraint)) {
      throw new Error(`Expected synthetic constraint ${expectedConstraint}, got status ${result.status}: ${result.stderr}`);
    }
    return "REJECTED";
  }
  if (result.status !== 0) throw new Error(`Synthetic SQL failed: ${result.stderr}`);
  return result.stdout.trim();
}

const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const kinds = {
  customer: {
    payment: "customer_payments", allocation: "customer_payment_allocations",
    entityColumn: "customer_id", entityTable: "customers", entityId: uuid(1),
    invoiceId: uuid(3), invoiceTable: "sales_invoices",
  },
  supplier: {
    payment: "supplier_payments", allocation: "supplier_payment_allocations",
    entityColumn: "supplier_id", entityTable: "suppliers", entityId: uuid(2),
    invoiceId: uuid(4), invoiceTable: "purchase_invoices",
  },
};

const journalSql = (journalId) =>
  `INSERT INTO journal_entries VALUES ('${journalId}', 'posted', 100, 100);`;
const voucherSql = (cfg, paymentId, journalId, reference) =>
  `INSERT INTO ${cfg.payment} (id, ${cfg.entityColumn}, journal_entry_id, amount, status, reference)
   VALUES ('${paymentId}', '${cfg.entityId}', '${journalId}', 100, 'posted', '${reference}');`;
const allocationSql = (cfg, paymentId) =>
  `INSERT INTO ${cfg.allocation} VALUES ('${paymentId}', '${cfg.invoiceId}', 0);`;

function state(cfg, journalId, paymentId) {
  const row = psql(`SELECT
    (SELECT count(*) FROM journal_entries WHERE id='${journalId}') || '|'
    || (SELECT count(*) FROM ${cfg.payment} WHERE id='${paymentId}') || '|'
    || (SELECT count(*) FROM ${cfg.allocation} WHERE payment_id='${paymentId}') || '|'
    || (SELECT balance FROM ${cfg.entityTable} WHERE id='${cfg.entityId}') || '|'
    || (SELECT paid_amount FROM ${cfg.invoiceTable} WHERE id='${cfg.invoiceId}');`);
  const parts = row.split("|").map(Number);
  if (parts.length !== 5 || parts.some((value) => !Number.isFinite(value))) {
    throw new Error(`Unexpected synthetic state for ${cfg.payment}`);
  }
  return parts;
}

function assertState(label, cfg, journalId, paymentId, expected) {
  const actual = state(cfg, journalId, paymentId);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
  process.stdout.write(`${label}: journal=${actual[0]} voucher=${actual[1]} allocation=${actual[2]} entity_balance=${actual[3]} invoice_paid=${actual[4]}\n`);
}

try {
  const started = docker([
    "run", "--rm", "-d", "--pull", "never", "--network", "none", "--name", name,
    "--memory", "256m", "--memory-swap", "256m", "--cpus", "0.5",
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:15-alpine",
  ]);
  if (started.status !== 0) throw new Error(`Disposable DB start failed: ${started.stderr}`);
  containerId = started.stdout.trim();
  const inspected = docker(["inspect", containerId]);
  if (inspected.status !== 0) throw new Error("Disposable DB inspection failed");
  const info = JSON.parse(inspected.stdout)[0];
  if (info.Id !== containerId || info.Name !== `/${name}` || info.HostConfig.NetworkMode !== "none"
    || (info.HostConfig.Binds ?? []).length || Object.keys(info.HostConfig.PortBindings ?? {}).length) {
    throw new Error("Disposable DB isolation check failed");
  }
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logs = docker(["logs", containerId]);
    if (String(logs.stdout + logs.stderr).includes("PostgreSQL init process complete")
      && docker(["exec", containerId, "pg_isready", "-U", "postgres"]).status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
  psql(fixture);

  let sequence = 100;
  for (const [kind, cfg] of Object.entries(kinds)) {
    const nextIds = () => ({ journalId: uuid(++sequence), paymentId: uuid(++sequence) });

    {
      const { journalId, paymentId } = nextIds();
      psql(journalSql(journalId)); // First browser/API request commits.
      psql(voucherSql(cfg, paymentId, journalId, "INJECT_FAIL"), `synthetic_${kind}_voucher_failure`);
      assertState(`${kind}_separate_voucher_failure`, cfg, journalId, paymentId, [1, 0, 0, 0, 0]);
    }
    {
      const { journalId, paymentId } = nextIds();
      psql(`BEGIN;\n${journalSql(journalId)}\n${voucherSql(cfg, paymentId, journalId, "INJECT_FAIL")}\nCOMMIT;`, `synthetic_${kind}_voucher_failure`);
      assertState(`${kind}_atomic_voucher_failure`, cfg, journalId, paymentId, [0, 0, 0, 0, 0]);
    }
    {
      const { journalId, paymentId } = nextIds();
      psql(journalSql(journalId));
      psql(voucherSql(cfg, paymentId, journalId, "OK"));
      psql(allocationSql(cfg, paymentId), `synthetic_${kind}_allocation_failure`);
      assertState(`${kind}_separate_allocation_failure`, cfg, journalId, paymentId, [1, 1, 0, 0, 0]);
    }
    {
      const { journalId, paymentId } = nextIds();
      psql(`BEGIN;\n${journalSql(journalId)}\n${voucherSql(cfg, paymentId, journalId, "OK")}\n${allocationSql(cfg, paymentId)}\nCOMMIT;`, `synthetic_${kind}_allocation_failure`);
      assertState(`${kind}_atomic_allocation_failure`, cfg, journalId, paymentId, [0, 0, 0, 0, 0]);
    }
    {
      const { journalId, paymentId } = nextIds();
      psql(journalSql(journalId));
      const updated = psql(`WITH updated AS (UPDATE ${cfg.payment} SET status='posted', journal_entry_id='${journalId}'
        WHERE id='${paymentId}' RETURNING 1) SELECT count(*) FROM updated;`);
      if (updated !== "0") throw new Error(`${kind}: missing draft unexpectedly updated`);
      assertState(`${kind}_missing_draft_update`, cfg, journalId, paymentId, [1, 0, 0, 0, 0]);
    }
  }
  process.stdout.write("POSTING_PARTIAL_FAILURE_REPRODUCED; SYNTHETIC_PG15_ONLY; NO_HOSTED_DB_WRITES\n");
} finally {
  if (containerId) {
    const stopped = docker(["stop", "--time", "2", containerId]);
    if (stopped.status !== 0) process.stderr.write(`Disposable container cleanup failed: ${containerId}\n`);
  }
}
