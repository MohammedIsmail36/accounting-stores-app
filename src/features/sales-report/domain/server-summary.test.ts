import { describe, expect, it } from "vitest";
import { parseSalesReportServerSummary } from "./server-summary";

describe("parseSalesReportServerSummary", () => {
  it("يحوّل قيم JSON الرقمية النصية ويحافظ على النسب الفارغة", () => {
    const result = parseSalesReportServerSummary({
      current: {
        invoice_count: 58,
        return_count: "2",
        invoice_total_including_tax: "105250.00",
        return_total_including_tax: "3130.00",
        sales_revenue_excluding_tax: "105250.00",
        return_revenue_excluding_tax: "3130.00",
        net_sales_revenue: "102120.00",
        sales_cogs: "71300.84",
        return_cogs: "2019.11",
        net_cogs: "69281.73",
        gross_profit: "32838.27",
        gross_margin_percent: "32.16",
        invoice_gross_total: "105250.00",
        cash_collected: "95000.00",
        return_settled: "500.00",
        total_covered: "95500.00",
        cash_collection_rate: null,
      },
      previous: {
        invoice_count: "40",
        gross_sales: "80000.00",
        returns_total: "1000.00",
        net_sales: "79000.00",
      },
    });

    expect(result.current.grossProfit).toBe(32838.27);
    expect(result.current.grossMarginPercent).toBe(32.16);
    expect(result.current.cashCollectionRate).toBeNull();
    expect(result.previous).toEqual({
      invoiceCount: 40,
      grossSales: 80000,
      returnsTotal: 1000,
      netSales: 79000,
    });
  });

  it("يعيد قيماً آمنة عند استجابة ناقصة أو غير صالحة", () => {
    const result = parseSalesReportServerSummary(null);

    expect(result.current.invoiceCount).toBe(0);
    expect(result.current.grossMarginPercent).toBeNull();
    expect(result.previous.netSales).toBe(0);
  });
});
