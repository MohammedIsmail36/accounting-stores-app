import { useMemo } from "react";
import {
  buildSalesCogsByInvoice,
  computeSalesReportMetrics,
} from "@/features/sales-report/domain/metrics";
import { computeInvoiceCoverage } from "@/features/sales-report/domain/collections";
import type { SalesReportServerSummary } from "@/features/sales-report/domain/server-summary";
import type { SalesReportStatusFilter } from "./use-sales-report-preferences";
import {
  buildSalesDocumentScopes,
  filterFinancialSalesMovements,
} from "@/features/sales-report/domain/document-scope";

interface UseSalesReportMetricsInput {
  invoices: any[];
  returns: any[];
  movements: any[];
  paymentAllocations: any[];
  returnSettlements: any[];
  statusFilter: SalesReportStatusFilter;
  serverSummary?: SalesReportServerSummary;
}

export function useSalesReportMetrics({
  invoices,
  returns,
  movements,
  paymentAllocations,
  returnSettlements,
  statusFilter,
  serverSummary,
}: UseSalesReportMetricsInput) {
  const {
    detailDocuments: detailInvoices,
    financialDocuments: financialInvoices,
  } = useMemo(
    () => buildSalesDocumentScopes(invoices, statusFilter),
    [invoices, statusFilter],
  );

  const {
    detailDocuments: detailReturns,
    financialDocuments: financialReturns,
  } = useMemo(
    () => buildSalesDocumentScopes(returns, statusFilter),
    [returns, statusFilter],
  );

  const financialMovements = useMemo(
    () =>
      filterFinancialSalesMovements(
        financialInvoices,
        financialReturns,
        movements,
      ),
    [financialInvoices, financialReturns, movements],
  );

  const invoiceCoverage = useMemo(
    () =>
      computeInvoiceCoverage(
        financialInvoices,
        paymentAllocations,
        returnSettlements,
      ),
    [financialInvoices, paymentAllocations, returnSettlements],
  );

  const kpi = useMemo(() => {
    const metrics = computeSalesReportMetrics({
      invoices: financialInvoices,
      returns: financialReturns,
      movements: financialMovements,
    });

    return {
      count: metrics.invoiceCount,
      grossSales: metrics.salesRevenueExcludingTax,
      returnsTotal: metrics.returnRevenueExcludingTax,
      netSales: metrics.netSalesRevenue,
      grossProfit: metrics.grossProfit,
      grossMarginPercent: metrics.grossMarginPercent,
      invoiceGrossTotal: invoiceCoverage.invoiceGrossTotal,
      cashCollected: invoiceCoverage.cashCollected,
      returnSettled: invoiceCoverage.returnSettled,
      totalCovered: invoiceCoverage.totalCovered,
      cashCollectionRate: invoiceCoverage.cashCollectionRate,
      cogs: metrics.netCogs,
    };
  }, [financialInvoices, financialReturns, financialMovements, invoiceCoverage]);

  const prevKpi = useMemo(
    () => ({
      count: serverSummary?.previous.invoiceCount ?? 0,
      grossSales: serverSummary?.previous.grossSales ?? 0,
      netSales: serverSummary?.previous.netSales ?? 0,
    }),
    [serverSummary],
  );

  const cogsByInvoice = useMemo(
    () => buildSalesCogsByInvoice(financialMovements),
    [financialMovements],
  );

  return {
    detailInvoices,
    financialInvoices,
    detailReturns,
    financialReturns,
    financialMovements,
    invoiceCoverage,
    kpi,
    prevKpi,
    cogsByInvoice,
  };
}
