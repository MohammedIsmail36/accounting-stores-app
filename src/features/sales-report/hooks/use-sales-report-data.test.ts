import {
  buildSalesReportQueryKeys,
  getSalesReportComparisonPeriod,
} from "./use-sales-report-data";

describe("buildSalesReportQueryKeys", () => {
  it("scopes every detail query to the selected period", () => {
    const keys = buildSalesReportQueryKeys("2026-08-01", "2026-08-31", {
      from: "2026-07-01",
      to: "2026-07-31",
    });

    expect(keys.invoices).toEqual([
      "sr-invoices",
      "2026-08-01",
      "2026-08-31",
    ]);
    expect(keys.returns).toEqual([
      "sr-returns",
      "2026-08-01",
      "2026-08-31",
    ]);
    expect(keys.movements).toEqual([
      "sr-cogs",
      "2026-08-01",
      "2026-08-31",
    ]);
    expect(keys.paymentAllocations).toEqual([
      "sr-payment-allocations",
      "2026-08-01",
      "2026-08-31",
    ]);
    expect(keys.returnSettlements).toEqual([
      "sr-return-settlements",
      "2026-08-01",
      "2026-08-31",
    ]);
  });

  it("includes both periods and the customer scope in the summary key", () => {
    const keys = buildSalesReportQueryKeys(
      "2026-08-01",
      "2026-08-31",
      {
        from: "2026-07-01",
        to: "2026-07-31",
      },
      "customer-1",
    );

    expect(keys.summary).toEqual([
      "sr-server-summary",
      "2026-08-01",
      "2026-08-31",
      "2026-07-01",
      "2026-07-31",
      "customer-1",
    ]);
  });
});

describe("getSalesReportComparisonPeriod", () => {
  it("uses the adjacent period by default", () => {
    expect(
      getSalesReportComparisonPeriod(
        "2026-08-01",
        "2026-08-31",
        "previous_period",
      ),
    ).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("uses the same date range from the previous year when selected", () => {
    expect(
      getSalesReportComparisonPeriod(
        "2026-07-01",
        "2026-09-30",
        "previous_year",
      ),
    ).toEqual({ from: "2025-07-01", to: "2025-09-30" });
  });
});
