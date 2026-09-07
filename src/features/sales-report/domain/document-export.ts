import { formatDisplayNumber } from "@/lib/posted-number-utils";
import type { InvoiceCoverage } from "./collections";
import {
  buildSalesInvoiceRowMetrics,
  type SalesInvoiceRowDocument,
} from "./invoice-row";
import { getDocumentAmountExcludingTax } from "./metrics";

type NumericValue = number | string | null | undefined;
type ExportCell = string | number;

interface SalesExportInvoice extends SalesInvoiceRowDocument {
  invoice_number: number;
  posted_number: number | null;
  invoice_date: string;
  customer?: { name?: string | null } | null;
  tax?: NumericValue;
}

interface SalesExportReturn {
  return_number: number;
  posted_number: number | null;
  return_date: string;
  status: string;
  total: NumericValue;
  tax?: NumericValue;
  customer?: { name?: string | null } | null;
  items?: unknown[] | null;
}

export interface DocumentSalesExportConfig {
  filenamePrefix: string;
  sheetName: string;
  pdfTitle: string;
  headers: string[];
  rows: ExportCell[][];
  pdfOrientation?: "landscape";
}

const getArabicDocumentStatus = (status: string | null) =>
  status === "posted" ? "مُرحّل" : status === "cancelled" ? "ملغي" : "مسودة";

export function buildInvoiceSalesExport({
  invoices,
  dateFrom,
  dateTo,
  invoicePrefix,
  cogsByInvoice,
  coverageByInvoice,
  today,
  detailStatusLabel,
}: {
  invoices: SalesExportInvoice[];
  dateFrom: string;
  dateTo: string;
  invoicePrefix: string;
  cogsByInvoice: Record<string, number>;
  coverageByInvoice: Record<string, InvoiceCoverage>;
  today: string;
  detailStatusLabel: string;
}): DocumentSalesExportConfig {
  return {
    filenamePrefix: `تقرير-المبيعات-${dateFrom}-${dateTo}`,
    sheetName: "المبيعات",
    pdfTitle: `تفاصيل فواتير المبيعات — ${detailStatusLabel} (${dateFrom} - ${dateTo})`,
    headers: [
      "رقم",
      "التاريخ",
      "العميل",
      "الحالة",
      "الإجمالي",
      "التحصيل النقدي/البنكي",
      "تسوية بمرتجع",
      "المتبقي",
      "تكلفة البضاعة",
      "الربح قبل المرتجعات المستقلة",
      "الهامش%",
      "متأخر",
    ],
    rows: invoices.map((invoice) => {
      const metrics = buildSalesInvoiceRowMetrics(
        invoice,
        cogsByInvoice,
        coverageByInvoice,
        today,
      );

      return [
        formatDisplayNumber(
          invoicePrefix,
          invoice.posted_number,
          invoice.invoice_number,
          invoice.status ?? "draft",
        ),
        invoice.invoice_date,
        invoice.customer?.name || "-",
        getArabicDocumentStatus(invoice.status),
        metrics.total,
        metrics.coverage.cashCollected,
        metrics.coverage.returnSettled,
        metrics.remaining,
        metrics.cogs,
        metrics.profit ?? "—",
        metrics.margin === null ? "—" : `${metrics.margin.toFixed(1)}%`,
        metrics.overdue ? "نعم" : "",
      ];
    }),
    pdfOrientation: "landscape",
  };
}

export function buildReturnSalesExport({
  returns,
  dateFrom,
  dateTo,
  returnPrefix,
  detailStatusLabel,
}: {
  returns: SalesExportReturn[];
  dateFrom: string;
  dateTo: string;
  returnPrefix: string;
  detailStatusLabel: string;
}): DocumentSalesExportConfig {
  return {
    filenamePrefix: `تقرير-مرتجعات-المبيعات-${dateFrom}-${dateTo}`,
    sheetName: "المرتجعات المستقلة",
    pdfTitle: `تفاصيل مرتجعات المبيعات المستقلة — ${detailStatusLabel} (${dateFrom} - ${dateTo})`,
    headers: [
      "رقم المرتجع",
      "التاريخ",
      "الحالة",
      "العميل",
      "عدد البنود",
      "المرتجع قبل الضريبة",
      "النوع",
    ],
    rows: returns.map((salesReturn) => [
      formatDisplayNumber(
        returnPrefix,
        salesReturn.posted_number,
        salesReturn.return_number,
        salesReturn.status,
      ),
      salesReturn.return_date,
      getArabicDocumentStatus(salesReturn.status),
      salesReturn.customer?.name || "عميل نقدي",
      (salesReturn.items ?? []).length,
      getDocumentAmountExcludingTax(salesReturn),
      "مستند مستقل",
    ]),
  };
}
