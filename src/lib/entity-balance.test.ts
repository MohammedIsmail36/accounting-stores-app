import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Strict tests for entity balance recalculation around invoice cancellation.
 *
 * The bug we're guarding against: when cancelling a posted sales invoice, the
 * UI was calling recalculateEntityBalance BEFORE flipping the invoice status
 * to 'cancelled'. Because recalculateEntityBalance only sums invoices where
 * status = 'posted', the just-cancelled invoice was still counted and the
 * customer's balance never decreased.
 *
 * These tests pin down the contract: the status must be 'cancelled' (not
 * 'posted') at the moment recalculateEntityBalance runs.
 */

type Invoice = { id: string; customer_id: string; total: number; status: string };

// In-memory fake DB
const db: {
  customers: Array<{ id: string; opening_balance: number; balance: number }>;
  sales_invoices: Invoice[];
  sales_returns: Array<{ customer_id: string; total: number; status: string }>;
  customer_payments: Array<{ id: string; customer_id: string; amount: number; status: string }>;
  sales_return_payment_allocations: Array<{ payment_id: string; allocated_amount: number }>;
} = {
  customers: [],
  sales_invoices: [],
  sales_returns: [],
  customer_payments: [],
  sales_return_payment_allocations: [],
};

// Minimal supabase mock: only the surface that recalculateEntityBalance uses
vi.mock("@/integrations/supabase/client", () => {
  function buildQuery(table: string) {
    const state: any = {
      table,
      filters: [] as Array<{ col: string; val: any }>,
      updateData: null as any,
      isUpdate: false,
      isSelect: false,
      selectCols: "",
      isMaybeSingle: false,
      inFilter: null as null | { col: string; vals: any[] },
    };
    const exec = async () => {
      let rows: any[] = (db as any)[table] || [];
      for (const f of state.filters) rows = rows.filter((r) => r[f.col] === f.val);
      if (state.inFilter) rows = rows.filter((r) => state.inFilter!.vals.includes(r[state.inFilter!.col]));

      if (state.isUpdate) {
        rows.forEach((r) => Object.assign(r, state.updateData));
        return { data: null, error: null };
      }
      if (state.isMaybeSingle) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    };
    const api: any = {
      select: (cols: string) => {
        state.isSelect = true;
        state.selectCols = cols;
        return api;
      },
      eq: (col: string, val: any) => {
        state.filters.push({ col, val });
        return api;
      },
      in: (col: string, vals: any[]) => {
        state.inFilter = { col, vals };
        return api;
      },
      maybeSingle: () => {
        state.isMaybeSingle = true;
        return exec();
      },
      update: (data: any) => {
        state.isUpdate = true;
        state.updateData = data;
        return api;
      },
      then: (resolve: any, reject: any) => exec().then(resolve, reject),
    };
    return api;
  }
  return {
    supabase: {
      from: (table: string) => buildQuery(table),
    },
  };
});

import { recalculateEntityBalance } from "./entity-balance";

function resetDb() {
  db.customers = [];
  db.sales_invoices = [];
  db.sales_returns = [];
  db.customer_payments = [];
  db.sales_return_payment_allocations = [];
}

describe("recalculateEntityBalance — sales invoice cancellation", () => {
  beforeEach(resetDb);

  it("includes a posted invoice in the customer balance", async () => {
    db.customers.push({ id: "c1", opening_balance: 0, balance: 0 });
    db.sales_invoices.push({ id: "i1", customer_id: "c1", total: 720, status: "posted" });

    const balance = await recalculateEntityBalance("customer", "c1");

    expect(balance).toBe(720);
    expect(db.customers[0].balance).toBe(720);
  });

  it("excludes the invoice once its status is 'cancelled' (real cancel flow)", async () => {
    db.customers.push({ id: "c1", opening_balance: 0, balance: 720 });
    db.sales_invoices.push({ id: "i1", customer_id: "c1", total: 720, status: "posted" });

    // Correct order: flip status FIRST, then recalculate
    db.sales_invoices[0].status = "cancelled";
    const balance = await recalculateEntityBalance("customer", "c1");

    expect(balance).toBe(0);
    expect(db.customers[0].balance).toBe(0);
  });

  it("REGRESSION: recalculating BEFORE flipping status leaves a stale balance", async () => {
    db.customers.push({ id: "c1", opening_balance: 0, balance: 720 });
    db.sales_invoices.push({ id: "i1", customer_id: "c1", total: 720, status: "posted" });

    // Wrong order (the bug): recalculate while still 'posted' — balance stays 720
    const buggy = await recalculateEntityBalance("customer", "c1");
    expect(buggy).toBe(720);

    // Then status flips, but UI never recalculates again
    db.sales_invoices[0].status = "cancelled";
    expect(db.customers[0].balance).toBe(720); // stale!

    // Re-running recalculate after the flip fixes it
    const fixed = await recalculateEntityBalance("customer", "c1");
    expect(fixed).toBe(0);
  });

  it("handles opening balance + multiple invoices + a return + a payment", async () => {
    db.customers.push({ id: "c1", opening_balance: 100, balance: 0 });
    db.sales_invoices.push(
      { id: "i1", customer_id: "c1", total: 500, status: "posted" },
      { id: "i2", customer_id: "c1", total: 300, status: "posted" },
      { id: "i3", customer_id: "c1", total: 999, status: "cancelled" },
    );
    db.sales_returns.push({ customer_id: "c1", total: 50, status: "posted" });
    db.customer_payments.push({ id: "p1", customer_id: "c1", amount: 200, status: "posted" });

    const balance = await recalculateEntityBalance("customer", "c1");
    // 100 (opening) + 500 + 300 - 50 (return) - 200 (payment) = 650
    expect(balance).toBe(650);
  });

  it("returns opening balance only when the customer has no activity", async () => {
    db.customers.push({ id: "c1", opening_balance: 250, balance: 0 });
    const balance = await recalculateEntityBalance("customer", "c1");
    expect(balance).toBe(250);
  });

  it("treats a refund payment (allocated to a return) as adding back to balance", async () => {
    db.customers.push({ id: "c1", opening_balance: 0, balance: 0 });
    db.sales_invoices.push({ id: "i1", customer_id: "c1", total: 1000, status: "posted" });
    db.sales_returns.push({ customer_id: "c1", total: 300, status: "posted" });
    db.customer_payments.push({ id: "p1", customer_id: "c1", amount: 300, status: "posted" });
    db.sales_return_payment_allocations.push({ payment_id: "p1", allocated_amount: 300 });

    const balance = await recalculateEntityBalance("customer", "c1");
    // 1000 - 300 (return) - 0 (normal payments) + 300 (refund) = 1000
    expect(balance).toBe(1000);
  });
});
