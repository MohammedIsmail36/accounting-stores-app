import { describe, expect, it } from "vitest";
import { buildSalesInvoiceRowMetrics } from "./invoice-row";

describe("buildSalesInvoiceRowMetrics", () => {
  it("calculates one posted invoice consistently before tax", () => {
    expect(
      buildSalesInvoiceRowMetrics(
        {
          id: "inv-1",
          status: "posted",
          total: 1150,
          tax: 150,
          due_date: "2026-08-31",
        },
        { "inv-1": 600 },
        {
          "inv-1": {
            cashCollected: 500,
            returnSettled: 100,
            totalCovered: 600,
          },
        },
        "2026-09-03",
      ),
    ).toEqual({
      total: 1150,
      revenueExcludingTax: 1000,
      cogs: 600,
      coverage: {
        cashCollected: 500,
        returnSettled: 100,
        totalCovered: 600,
      },
      remaining: 550,
      profit: 400,
      margin: 40,
      overdue: true,
    });
  });

  it("does not expose profit or margin for a draft", () => {
    const result = buildSalesInvoiceRowMetrics(
      { id: "draft", status: "draft", total: 100, tax: 0 },
      { draft: 30 },
      {},
      "2026-09-03",
    );

    expect(result.profit).toBeNull();
    expect(result.margin).toBeNull();
    expect(result.overdue).toBe(false);
  });

  it("keeps posted profit but leaves margin undefined without positive cost", () => {
    const result = buildSalesInvoiceRowMetrics(
      { id: "no-cost", status: "posted", total: "100", tax: null },
      {},
      {},
      "2026-09-03",
    );

    expect(result.profit).toBe(100);
    expect(result.margin).toBeNull();
  });

  it("neutralizes invalid numeric values instead of propagating NaN", () => {
    const result = buildSalesInvoiceRowMetrics(
      { id: "invalid", status: "posted", total: "invalid", tax: 10 },
      { invalid: Number.NaN },
      {},
      "2026-09-03",
    );

    expect(result.total).toBe(0);
    expect(result.cogs).toBe(0);
    expect(result.profit).toBe(-10);
    expect(result.margin).toBeNull();
  });
});
