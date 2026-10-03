import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));

import { recalculateEntityBalance } from "./entity-balance";
import { getNextPostedNumber } from "./posted-number-utils";

type DbResponse = { data: any; error: Error | null };
const responses: Record<string, DbResponse> = {};
const updates: Array<{ table: string; payload: unknown }> = [];
let updateResponse: DbResponse;

beforeEach(() => {
  vi.clearAllMocks();
  for (const table of Object.keys(responses)) delete responses[table];
  updates.length = 0;
  updateResponse = { data: null, error: null };
  mocks.from.mockImplementation((table: string) => {
    let isUpdate = false;
    const query: any = {
      select: () => query,
      eq: () => query,
      in: () => query,
      not: () => query,
      order: () => query,
      limit: async () => responses[table],
      maybeSingle: async () => responses[table],
      update: (payload: unknown) => {
        isUpdate = true;
        updates.push({ table, payload });
        return query;
      },
      then: (resolve: (value: DbResponse) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(isUpdate ? updateResponse : responses[table]).then(resolve, reject),
    };
    return query;
  });
});

describe("RED characterization: incomplete balance reads and numbering errors", () => {
  for (const kind of ["customer", "supplier"] as const) {
    it(`${kind}: writes a partial balance after an invoice query error`, async () => {
      const invoiceTable = kind === "customer" ? "sales_invoices" : "purchase_invoices";
      const returnTable = kind === "customer" ? "sales_returns" : "purchase_returns";
      const paymentTable = kind === "customer" ? "customer_payments" : "supplier_payments";
      const entityTable = kind === "customer" ? "customers" : "suppliers";
      responses[invoiceTable] = { data: null, error: new Error("SYNTHETIC_INVOICE_QUERY_FAILED") };
      responses[returnTable] = { data: [], error: null };
      responses[paymentTable] = { data: [], error: null };
      responses[entityTable] = { data: { opening_balance: 100, balance: 500 }, error: null };

      const calculated = await recalculateEntityBalance(kind, "synthetic-entity");

      expect(calculated).toBe(100);
      expect(updates).toEqual([{ table: entityTable, payload: { balance: 100 } }]);
    });

    it(`${kind}: returns a calculated balance despite a failed balance write`, async () => {
      const invoiceTable = kind === "customer" ? "sales_invoices" : "purchase_invoices";
      const returnTable = kind === "customer" ? "sales_returns" : "purchase_returns";
      const paymentTable = kind === "customer" ? "customer_payments" : "supplier_payments";
      const entityTable = kind === "customer" ? "customers" : "suppliers";
      responses[invoiceTable] = { data: [], error: null };
      responses[returnTable] = { data: [], error: null };
      responses[paymentTable] = { data: [], error: null };
      responses[entityTable] = { data: { opening_balance: 100 }, error: null };
      updateResponse = { data: null, error: new Error("SYNTHETIC_BALANCE_WRITE_FAILED") };

      const calculated = await recalculateEntityBalance(kind, "synthetic-entity");

      expect(calculated).toBe(100);
      expect(updates).toEqual([{ table: entityTable, payload: { balance: 100 } }]);
    });
  }

  it("suggests posted number 1 when the last-number query fails", async () => {
    responses.customer_payments = { data: null, error: new Error("SYNTHETIC_NUMBER_QUERY_FAILED") };

    await expect(getNextPostedNumber("customer_payments")).resolves.toBe(1);
  });
});
