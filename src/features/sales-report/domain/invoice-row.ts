import type { InvoiceCoverage } from "./collections";
import {
  getInvoiceCoverage,
  isSalesInvoiceOverdue,
  type SalesInsightInvoice,
} from "./insights";

type NumericValue = number | string | null | undefined;

export interface SalesInvoiceRowDocument extends SalesInsightInvoice {
  tax?: NumericValue;
}

const toFiniteNumber = (value: NumericValue): number => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

/** Shared invoice-row calculations used by both the table and export. */
export function buildSalesInvoiceRowMetrics(
  invoice: SalesInvoiceRowDocument,
  cogsByInvoice: Record<string, number>,
  coverageByInvoice: Record<string, InvoiceCoverage>,
  today: string,
) {
  const total = toFiniteNumber(invoice.total);
  const revenueExcludingTax = total - toFiniteNumber(invoice.tax);
  const cogs = toFiniteNumber(cogsByInvoice[invoice.id]);
  const coverage = getInvoiceCoverage(invoice.id, coverageByInvoice);
  const isPosted = invoice.status === "posted";
  const profit = isPosted ? revenueExcludingTax - cogs : null;
  const margin =
    profit !== null && revenueExcludingTax > 0 && cogs > 0
      ? (profit / revenueExcludingTax) * 100
      : null;

  return {
    total,
    revenueExcludingTax,
    cogs,
    coverage,
    remaining: total - coverage.totalCovered,
    profit,
    margin,
    overdue: isSalesInvoiceOverdue(invoice, coverageByInvoice, today),
  };
}
