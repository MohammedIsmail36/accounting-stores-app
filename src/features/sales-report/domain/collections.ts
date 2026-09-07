import { round2 } from "@/lib/utils";

// Collection coverage rules used exclusively by the sales report feature.

type NumericValue = number | string | null | undefined;

export interface CoverageInvoice {
  id: string;
  status: string | null;
  total: NumericValue;
}

export interface InvoicePaymentAllocation {
  invoice_id: string;
  allocated_amount: NumericValue;
}

export interface InvoiceReturnSettlement {
  invoice_id: string;
  settled_amount: NumericValue;
}

export interface InvoiceCoverage {
  cashCollected: number;
  returnSettled: number;
  totalCovered: number;
}

const toFiniteNumber = (value: NumericValue): number => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

/**
 * Separates real payment allocations from return-credit settlements.
 * The denominator is the posted invoice total including tax because both
 * allocation types settle the invoice receivable (which includes tax).
 */
export function computeInvoiceCoverage(
  invoices: CoverageInvoice[],
  paymentAllocations: InvoicePaymentAllocation[],
  returnSettlements: InvoiceReturnSettlement[],
) {
  const postedInvoices = invoices.filter(({ status }) => status === "posted");
  const postedInvoiceIds = new Set(postedInvoices.map(({ id }) => id));
  const byInvoice: Record<string, InvoiceCoverage> = {};

  postedInvoices.forEach(({ id }) => {
    byInvoice[id] = { cashCollected: 0, returnSettled: 0, totalCovered: 0 };
  });

  paymentAllocations.forEach(({ invoice_id, allocated_amount }) => {
    if (!postedInvoiceIds.has(invoice_id)) return;
    byInvoice[invoice_id].cashCollected += toFiniteNumber(allocated_amount);
  });

  returnSettlements.forEach(({ invoice_id, settled_amount }) => {
    if (!postedInvoiceIds.has(invoice_id)) return;
    byInvoice[invoice_id].returnSettled += toFiniteNumber(settled_amount);
  });

  Object.values(byInvoice).forEach((coverage) => {
    coverage.cashCollected = round2(coverage.cashCollected);
    coverage.returnSettled = round2(coverage.returnSettled);
    coverage.totalCovered = round2(
      coverage.cashCollected + coverage.returnSettled,
    );
  });

  const invoiceGrossTotal = round2(
    postedInvoices.reduce((sum, invoice) => sum + toFiniteNumber(invoice.total), 0),
  );
  const cashCollected = round2(
    Object.values(byInvoice).reduce((sum, row) => sum + row.cashCollected, 0),
  );
  const returnSettled = round2(
    Object.values(byInvoice).reduce((sum, row) => sum + row.returnSettled, 0),
  );
  const totalCovered = round2(cashCollected + returnSettled);

  return {
    byInvoice,
    invoiceGrossTotal,
    cashCollected,
    returnSettled,
    totalCovered,
    outstanding: round2(invoiceGrossTotal - totalCovered),
    cashCollectionRate:
      invoiceGrossTotal > 0
        ? round2((cashCollected / invoiceGrossTotal) * 100)
        : null,
    totalCoverageRate:
      invoiceGrossTotal > 0
        ? round2((totalCovered / invoiceGrossTotal) * 100)
        : null,
  };
}
