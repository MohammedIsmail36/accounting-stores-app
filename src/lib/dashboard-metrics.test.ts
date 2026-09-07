import { describe, it, expect } from "vitest";
import {
  bucketExpenseLines,
  computeAgingBuckets,
  computeCOGS,
  computeCustomerConcentration,
  computeDerivedTotals,
  computeLiquidity,
  computeMonthlyChange,
  relationDate,
  sumNet,
  sumTotal,
} from "./dashboard-metrics";

describe("relationDate", () => {
  it("reads embedded object relation", () => {
    expect(relationDate({ invoice: { invoice_date: "2026-01-05" } }, "invoice", "invoice_date")).toBe("2026-01-05");
  });
  it("reads single-element array relation", () => {
    expect(relationDate({ return: [{ return_date: "2026-02-02" }] }, "return", "return_date")).toBe("2026-02-02");
  });
  it("returns empty string when missing", () => {
    expect(relationDate({}, "invoice", "invoice_date")).toBe("");
  });
});

describe("sumNet / sumTotal", () => {
  it("prefers net_total over total", () => {
    expect(sumNet([{ total: 100, net_total: 90 }, { total: 50 }])).toBe(140);
  });
  it("treats net_total = 0 as a real value", () => {
    expect(sumNet([{ total: 100, net_total: 0 }])).toBe(0);
  });
  it("sums total only", () => {
    expect(sumTotal([{ total: 10, net_total: 5 }, { total: 15 }])).toBe(25);
  });
});

describe("computeCOGS", () => {
  it("adds sales cost and credits back sale returns", () => {
    expect(
      computeCOGS([
        { movement_type: "sale", total_cost: 300 },
        { movement_type: "sale_return", total_cost: 100 },
        { movement_type: "purchase", total_cost: 999 },
      ]),
    ).toBe(200);
  });
});

describe("bucketExpenseLines", () => {
  it("splits operating vs system adjustments and nets 4201 gain", () => {
    const res = bucketExpenseLines(
      [
        { accounts: { code: "5102" }, debit: 500, credit: 0 },
        { accounts: { code: "5108" }, debit: 200, credit: 0 },
        { accounts: { code: "5201" }, debit: 100, credit: 0 },
      ],
      [{ debit: 0, credit: 120 }],
    );
    expect(res.operating).toBe(500);
    expect(res.system).toBe(180);
    expect(res.total).toBe(680);
  });
  it("handles credit-side expense reversals", () => {
    const res = bucketExpenseLines([{ accounts: { code: "5102" }, debit: 0, credit: 400 }], []);
    expect(res.operating).toBe(-400);
    expect(res.total).toBe(-400);
  });
});

describe("computeMonthlyChange", () => {
  const rows = [
    { d: "2026-08-10", v: 150 },
    { d: "2026-07-10", v: 100 },
  ];
  const getDate = (r: any) => r.d;
  const getValue = (r: any) => r.v;

  it("computes percentage growth vs previous month", () => {
    expect(computeMonthlyChange(rows, getDate, getValue, new Date("2026-08-27"))).toBeCloseTo(50);
  });
  it("returns null with no previous-month base", () => {
    expect(computeMonthlyChange([{ d: "2026-08-10", v: 150 }], getDate, getValue, new Date("2026-08-27"))).toBeNull();
  });
  it("rolls back to December when current month is January", () => {
    const jan = [
      { d: "2026-01-05", v: 50 },
      { d: "2025-12-05", v: 100 },
    ];
    expect(computeMonthlyChange(jan, getDate, getValue, new Date("2026-01-20"))).toBeCloseTo(-50);
  });
});

describe("computeLiquidity", () => {
  it("splits cash (1101*) and bank (1102*) net balances", () => {
    const res = computeLiquidity([
      { code: "110101", debit: 1000, credit: 200 },
      { code: "110201", debit: 5000, credit: 0 },
      { code: "1104", debit: 9999, credit: 0 },
    ]);
    expect(res.cash).toBe(800);
    expect(res.bank).toBe(5000);
    expect(res.total).toBe(5800);
  });
});

describe("computeAgingBuckets", () => {
  it("buckets remaining amounts by age and skips settled invoices", () => {
    const now = new Date("2026-08-27");
    const res = computeAgingBuckets(
      [
        { invoice_date: "2026-08-20", total: 100, paid_amount: 0 },
        { invoice_date: "2026-07-10", total: 200, paid_amount: 50 },
        { invoice_date: "2026-06-10", total: 300, paid_amount: 0 },
        { invoice_date: "2026-01-10", total: 400, paid_amount: 0 },
        { invoice_date: "2026-08-01", total: 100, paid_amount: 100 },
      ],
      now,
    );
    expect(res.map((b) => [b.count, b.total])).toEqual([
      [1, 100],
      [1, 150],
      [1, 300],
      [1, 400],
    ]);
  });
});

describe("computeCustomerConcentration", () => {
  it("ranks customers and computes share", () => {
    const res = computeCustomerConcentration(
      [
        { customer_id: "a", total: 600 },
        { customer_id: "b", total: 300 },
        { customer_id: null, total: 100 },
      ],
      (id) => (id === "__cash__" ? "عميل نقدي" : id),
    );
    expect(res[0]).toEqual({ name: "a", total: 600, percentage: 60 });
    expect(res[2].name).toBe("عميل نقدي");
  });
  it("returns empty list when there are no sales", () => {
    expect(computeCustomerConcentration([], (id) => id)).toEqual([]);
  });
});

describe("computeDerivedTotals", () => {
  it("applies Net Sales - COGS - Opex", () => {
    const res = computeDerivedTotals({
      totalSales: 20000,
      totalSalesReturns: 2000,
      totalPurchases: 10000,
      totalPurchaseReturns: 1000,
      totalCOGS: 9000,
      totalExpenses: 4000,
    });
    expect(res.netSales).toBe(18000);
    expect(res.netPurchases).toBe(9000);
    expect(res.grossProfit).toBe(9000);
    expect(res.netProfit).toBe(5000);
    expect(res.profitMargin).toBe("27.8");
  });
  it("guards against division by zero", () => {
    const res = computeDerivedTotals({
      totalSales: 0,
      totalSalesReturns: 0,
      totalPurchases: 0,
      totalPurchaseReturns: 0,
      totalCOGS: 0,
      totalExpenses: 500,
    });
    expect(res.netProfit).toBe(-500);
    expect(res.profitMargin).toBe("0");
  });
});
