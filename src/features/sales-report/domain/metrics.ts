import { round2 } from "@/lib/utils";

// Financial rules used exclusively by the sales report feature.

type NumericValue = number | string | null | undefined;

export interface SalesReportDocumentRow {
  status: string | null;
  total: NumericValue;
  tax?: NumericValue;
}

export interface SalesCostMovementRow {
  movement_type: string | null;
  total_cost: NumericValue;
}

export interface SalesReportMetricsInput {
  invoices: SalesReportDocumentRow[];
  returns: SalesReportDocumentRow[];
  movements: SalesCostMovementRow[];
}

export interface SalesReportMetrics {
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
}

interface SalesCostMovement {
  reference_type?: string | null;
  reference_id?: string | null;
  movement_type?: string | null;
  total_cost?: NumericValue;
}

export function buildSalesCogsByInvoice(
  movements: SalesCostMovement[],
): Record<string, number> {
  return movements.reduce<Record<string, number>>((totals, movement) => {
    if (
      movement.reference_type !== "sales_invoice" ||
      !movement.reference_id ||
      movement.movement_type !== "sale"
    ) {
      return totals;
    }

    totals[movement.reference_id] =
      (totals[movement.reference_id] ?? 0) + Number(movement.total_cost ?? 0);
    return totals;
  }, {});
}

function toFiniteNumber(value: NumericValue): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function getDocumentAmountExcludingTax(document: {
  total: NumericValue;
  tax?: NumericValue;
}): number {
  return round2(
    toFiniteNumber(document.total) - toFiniteNumber(document.tax),
  );
}

/**
 * Calculates the financial KPIs for a sales-report period.
 *
 * Only posted documents affect financial results. Sales returns are standalone
 * documents: they are included by their own date and need no invoice link.
 * Document totals already contain all invoice/line/loyalty discounts.
 */
export function computeSalesReportMetrics({
  invoices,
  returns,
  movements,
}: SalesReportMetricsInput): SalesReportMetrics {
  const postedInvoices = invoices.filter(({ status }) => status === "posted");
  const postedReturns = returns.filter(({ status }) => status === "posted");

  const invoiceTotalIncludingTax = round2(
    sum(postedInvoices.map(({ total }) => toFiniteNumber(total))),
  );
  const returnTotalIncludingTax = round2(
    sum(postedReturns.map(({ total }) => toFiniteNumber(total))),
  );
  const salesRevenueExcludingTax = round2(
    sum(
      postedInvoices.map(getDocumentAmountExcludingTax),
    ),
  );
  const returnRevenueExcludingTax = round2(
    sum(
      postedReturns.map(getDocumentAmountExcludingTax),
    ),
  );
  const salesCogs = round2(
    sum(
      movements
        .filter(({ movement_type }) => movement_type === "sale")
        .map(({ total_cost }) => toFiniteNumber(total_cost)),
    ),
  );
  const returnCogs = round2(
    sum(
      movements
        .filter(({ movement_type }) => movement_type === "sale_return")
        .map(({ total_cost }) => toFiniteNumber(total_cost)),
    ),
  );
  const netSalesRevenue = round2(
    salesRevenueExcludingTax - returnRevenueExcludingTax,
  );
  const netCogs = round2(salesCogs - returnCogs);
  const grossProfit = round2(netSalesRevenue - netCogs);
  const grossMarginPercent =
    netSalesRevenue > 0 && netCogs > 0
      ? round2((grossProfit / netSalesRevenue) * 100)
      : null;

  return {
    invoiceCount: postedInvoices.length,
    returnCount: postedReturns.length,
    invoiceTotalIncludingTax,
    returnTotalIncludingTax,
    salesRevenueExcludingTax,
    returnRevenueExcludingTax,
    netSalesRevenue,
    salesCogs,
    returnCogs,
    netCogs,
    grossProfit,
    grossMarginPercent,
  };
}

/** Prefer net_total when it exists; a legitimate zero must not fall back. */
export function getSalesLineNetAmount(line: {
  net_total?: NumericValue;
  total?: NumericValue;
}): number {
  return round2(toFiniteNumber(line.net_total ?? line.total));
}
