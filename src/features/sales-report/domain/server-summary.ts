// Runtime validation for the sales report summary returned by PostgreSQL.
type JsonRecord = Record<string, unknown>;

export interface SalesReportServerSummary {
  current: {
    invoiceCount: number;
    returnCount: number;
    invoiceTotalIncludingTax: number;
    returnTotalIncludingTax: number;
    salesRevenueExcludingTax: number;
    returnRevenueExcludingTax: number;
    netSalesRevenue: number;
    salesCogs: number;
    returnCogs: number;
    netCogs: number;
    grossProfit: number;
    grossMarginPercent: number | null;
    invoiceGrossTotal: number;
    cashCollected: number;
    returnSettled: number;
    totalCovered: number;
    cashCollectionRate: number | null;
  };
  previous: {
    invoiceCount: number;
    grossSales: number;
    returnsTotal: number;
    netSales: number;
  };
}

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const asNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asNullableNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : asNumber(value);

export function parseSalesReportServerSummary(
  value: unknown,
): SalesReportServerSummary {
  const root = asRecord(value);
  const current = asRecord(root.current);
  const previous = asRecord(root.previous);

  return {
    current: {
      invoiceCount: asNumber(current.invoice_count),
      returnCount: asNumber(current.return_count),
      invoiceTotalIncludingTax: asNumber(current.invoice_total_including_tax),
      returnTotalIncludingTax: asNumber(current.return_total_including_tax),
      salesRevenueExcludingTax: asNumber(current.sales_revenue_excluding_tax),
      returnRevenueExcludingTax: asNumber(current.return_revenue_excluding_tax),
      netSalesRevenue: asNumber(current.net_sales_revenue),
      salesCogs: asNumber(current.sales_cogs),
      returnCogs: asNumber(current.return_cogs),
      netCogs: asNumber(current.net_cogs),
      grossProfit: asNumber(current.gross_profit),
      grossMarginPercent: asNullableNumber(current.gross_margin_percent),
      invoiceGrossTotal: asNumber(current.invoice_gross_total),
      cashCollected: asNumber(current.cash_collected),
      returnSettled: asNumber(current.return_settled),
      totalCovered: asNumber(current.total_covered),
      cashCollectionRate: asNullableNumber(current.cash_collection_rate),
    },
    previous: {
      invoiceCount: asNumber(previous.invoice_count),
      grossSales: asNumber(previous.gross_sales),
      returnsTotal: asNumber(previous.returns_total),
      netSales: asNumber(previous.net_sales),
    },
  };
}
