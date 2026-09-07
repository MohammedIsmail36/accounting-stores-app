import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPaged } from "@/lib/paged-fetch";
import {
  getPreviousPeriod,
  getSamePeriodPreviousYear,
} from "@/lib/report-period";
import type { SalesReportComparisonMode } from "./use-sales-report-preferences";
import type {
  InvoicePaymentAllocation,
  InvoiceReturnSettlement,
} from "@/features/sales-report/domain/collections";
import { parseSalesReportServerSummary } from "@/features/sales-report/domain/server-summary";

const PAGE_SIZE = 500;
const MAX_REPORT_ROWS = 250_000;

export function buildSalesReportQueryKeys(
  dateFrom: string,
  dateTo: string,
  previousPeriod: { from: string; to: string },
  customerFilter: string | null = null,
) {
  return {
    invoices: ["sr-invoices", dateFrom, dateTo] as const,
    returns: ["sr-returns", dateFrom, dateTo] as const,
    movements: ["sr-cogs", dateFrom, dateTo] as const,
    paymentAllocations: [
      "sr-payment-allocations",
      dateFrom,
      dateTo,
    ] as const,
    returnSettlements: [
      "sr-return-settlements",
      dateFrom,
      dateTo,
    ] as const,
    summary: [
      "sr-server-summary",
      dateFrom,
      dateTo,
      previousPeriod.from,
      previousPeriod.to,
      customerFilter,
    ] as const,
  };
}

export function getSalesReportComparisonPeriod(
  dateFrom: string,
  dateTo: string,
  comparisonMode: SalesReportComparisonMode,
) {
  return comparisonMode === "previous_year"
    ? getSamePeriodPreviousYear(dateFrom, dateTo)
    : getPreviousPeriod(dateFrom, dateTo);
}

export function useSalesReportData(
  dateFrom: string,
  dateTo: string,
  customerFilter: string | null = null,
  comparisonMode: SalesReportComparisonMode = "previous_period",
) {
  const previousPeriod = useMemo(
    () => getSalesReportComparisonPeriod(dateFrom, dateTo, comparisonMode),
    [dateFrom, dateTo, comparisonMode],
  );
  const queryKeys = buildSalesReportQueryKeys(
    dateFrom,
    dateTo,
    previousPeriod,
    customerFilter,
  );

  const invoicesQuery = useQuery({
    queryKey: queryKeys.invoices,
    queryFn: ({ signal }) =>
      fetchAllPaged<any>(
        () =>
          supabase
            .from("sales_invoices")
            .select(
              "id, invoice_number, posted_number, invoice_date, due_date, status, subtotal, discount, tax, total, customer_id, customer:customers(name), items:sales_invoice_items(description, quantity, total, net_total, product_id, product:products(name, model_number, category_id, category:product_categories(name), brand:product_brands(name)))",
              { count: "exact" },
            )
            .gte("invoice_date", dateFrom)
            .lte("invoice_date", dateTo)
            .order("invoice_date", { ascending: false })
            .order("id", { ascending: true }),
        { batchSize: PAGE_SIZE, maxRows: MAX_REPORT_ROWS, signal },
      ),
  });

  const returnsQuery = useQuery({
    queryKey: queryKeys.returns,
    queryFn: ({ signal }) =>
      fetchAllPaged<any>(
        () =>
          supabase
            .from("sales_returns")
            .select(
              "id, return_number, posted_number, reference, return_date, total, tax, status, customer_id, customer:customers(name), items:sales_return_items(description, quantity, total, net_total, product_id, product:products(name, model_number, category_id, category:product_categories(name), brand:product_brands(name)))",
              { count: "exact" },
            )
            .gte("return_date", dateFrom)
            .lte("return_date", dateTo)
            .order("return_date", { ascending: false })
            .order("id", { ascending: true }),
        { batchSize: PAGE_SIZE, maxRows: MAX_REPORT_ROWS, signal },
      ),
  });

  const movementsQuery = useQuery({
    queryKey: queryKeys.movements,
    queryFn: ({ signal }) =>
      fetchAllPaged<any>(
        () =>
          supabase
            .from("inventory_movements")
            .select(
              "id, product_id, movement_type, quantity, total_cost, movement_date, reference_id, reference_type",
              { count: "exact" },
            )
            .in("movement_type", ["sale", "sale_return"])
            .gte("movement_date", dateFrom)
            .lte("movement_date", dateTo)
            .order("movement_date", { ascending: false })
            .order("id", { ascending: true }),
        { batchSize: PAGE_SIZE, maxRows: MAX_REPORT_ROWS, signal },
      ),
  });

  const paymentAllocationsQuery = useQuery({
    queryKey: queryKeys.paymentAllocations,
    queryFn: ({ signal }) =>
      fetchAllPaged<InvoicePaymentAllocation>(
        () =>
          supabase
            .from("customer_payment_allocations")
            .select(
              "id, invoice_id, allocated_amount, payment:customer_payments!inner(status), invoice:sales_invoices!inner(status, invoice_date)",
              { count: "exact" },
            )
            .eq("payment.status", "posted")
            .eq("invoice.status", "posted")
            .gte("invoice.invoice_date", dateFrom)
            .lte("invoice.invoice_date", dateTo)
            .order("id", { ascending: true }),
        { batchSize: PAGE_SIZE, maxRows: MAX_REPORT_ROWS, signal },
      ),
  });

  const returnSettlementsQuery = useQuery({
    queryKey: queryKeys.returnSettlements,
    queryFn: ({ signal }) =>
      fetchAllPaged<InvoiceReturnSettlement>(
        () =>
          supabase
            .from("sales_invoice_return_settlements")
            .select(
              "id, invoice_id, return_id, settled_amount, invoice:sales_invoices!inner(status, invoice_date), sales_return:sales_returns!inner(status)",
              { count: "exact" },
            )
            .eq("invoice.status", "posted")
            .eq("sales_return.status", "posted")
            .gte("invoice.invoice_date", dateFrom)
            .lte("invoice.invoice_date", dateTo)
            .order("id", { ascending: true }),
        { batchSize: PAGE_SIZE, maxRows: MAX_REPORT_ROWS, signal },
      ),
  });

  const summaryQuery = useQuery({
    queryKey: queryKeys.summary,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .rpc("get_sales_report_summary_filtered", {
          p_date_from: dateFrom,
          p_date_to: dateTo,
          p_previous_from: previousPeriod.from,
          p_previous_to: previousPeriod.to,
          p_customer_filter: customerFilter,
        })
        .abortSignal(signal);
      if (error) throw error;
      return parseSalesReportServerSummary(data);
    },
    staleTime: 30_000,
  });

  return {
    invoicesQuery,
    returnsQuery,
    movementsQuery,
    paymentAllocationsQuery,
    returnSettlementsQuery,
    summaryQuery,
    invoices: invoicesQuery.data ?? [],
    returns: returnsQuery.data ?? [],
    movements: movementsQuery.data ?? [],
    paymentAllocations: paymentAllocationsQuery.data ?? [],
    returnSettlements: returnSettlementsQuery.data ?? [],
  };
}
