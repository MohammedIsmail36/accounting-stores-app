import type {
  CategorySalesGroup,
  CustomerSalesGroup,
  ProductSalesGroup,
  SalesTimeMode,
  TimeSalesGroup,
} from "./grouping";

type AggregateSalesGroup = "customer" | "product" | "category" | "time";
type ExportCell = string | number;

interface AggregateSalesExportInput {
  groupBy: AggregateSalesGroup;
  dateFrom: string;
  dateTo: string;
  timeMode: SalesTimeMode;
  isPostedOnly: boolean;
  customerData: CustomerSalesGroup[];
  productData: ProductSalesGroup[];
  categoryData: CategorySalesGroup[];
  timeData: TimeSalesGroup[];
}

export interface AggregateSalesExportConfig {
  filenamePrefix: string;
  sheetName: string;
  pdfTitle: string;
  headers: string[];
  rows: ExportCell[][];
  pdfOrientation?: "landscape";
}

const formatOptionalPercent = (value: number | null) =>
  value === null ? "—" : `${value.toFixed(1)}%`;

export function buildAggregateSalesExport({
  groupBy,
  dateFrom,
  dateTo,
  timeMode,
  isPostedOnly,
  customerData,
  productData,
  categoryData,
  timeData,
}: AggregateSalesExportInput): AggregateSalesExportConfig {
  if (groupBy === "customer") {
    return {
      filenamePrefix: `تقرير-مبيعات-بالعميل-${dateFrom}-${dateTo}`,
      sheetName: "بالعميل",
      pdfTitle: `تقرير المبيعات بالعميل (${dateFrom} - ${dateTo})`,
      headers: [
        "العميل",
        "عدد الفواتير",
        "المبيعات قبل الضريبة",
        "المرتجعات",
        "الصافي",
        "الفواتير شامل الضريبة",
        "التحصيل النقدي/البنكي",
        "تسوية بمرتجع",
        "المتبقي",
        "التحصيل النقدي%",
      ],
      rows: customerData.map((customer) => [
        customer.name,
        customer.count,
        customer.total,
        customer.returns,
        customer.total - customer.returns,
        customer.invoiceGrossTotal,
        customer.cashCollected,
        customer.returnSettled,
        customer.invoiceGrossTotal -
          customer.cashCollected -
          customer.returnSettled,
        customer.invoiceGrossTotal > 0
          ? `${((customer.cashCollected / customer.invoiceGrossTotal) * 100).toFixed(1)}%`
          : "—",
      ]),
      pdfOrientation: "landscape",
    };
  }

  if (groupBy === "product") {
    return {
      filenamePrefix: `تقرير-مبيعات-بالمنتج-${dateFrom}-${dateTo}`,
      sheetName: "بالمنتج",
      pdfTitle: `تقرير المبيعات بالمنتج (${dateFrom} - ${dateTo})`,
      headers: [
        "المنتج",
        "الكمية المباعة",
        "المرتجع",
        "صافي الكمية",
        "الإيرادات الصافية",
        "التكلفة",
        "الربح",
        "الهامش%",
      ],
      rows: productData.map((product) => [
        product.name,
        product.qtySold,
        product.qtyReturned,
        product.qtySold - product.qtyReturned,
        product.revenue,
        product.cogs,
        product.revenue - product.cogs,
        product.revenue > 0 && product.cogs > 0
          ? `${(((product.revenue - product.cogs) / product.revenue) * 100).toFixed(1)}%`
          : "—",
      ]),
    };
  }

  if (groupBy === "category") {
    return {
      filenamePrefix: `تقرير-مبيعات-بالتصنيف-${dateFrom}-${dateTo}`,
      sheetName: "بالتصنيف",
      pdfTitle: `تقرير المبيعات بالتصنيف (${dateFrom} - ${dateTo})`,
      headers: [
        "التصنيف",
        "منتجات",
        "الكمية المباعة",
        "الكمية المرتجعة",
        "المبيعات",
        "المرتجعات",
        "صافي الإيرادات",
        "% المرتجعات",
        ...(isPostedOnly ? ["الربح", "الهامش %"] : []),
        "% المساهمة",
      ],
      rows: categoryData.map((category) => [
        category.name,
        category.productCount,
        category.qtySold,
        category.qtyReturned,
        category.revenue,
        category.returns,
        category.net,
        category.returns > 0
          ? category.returnRate === null
            ? "مرتجع فقط"
            : formatOptionalPercent(category.returnRate)
          : "—",
        ...(isPostedOnly
          ? [
              category.profit,
              formatOptionalPercent(category.margin),
            ]
          : []),
        formatOptionalPercent(category.pctOfTotal),
      ]),
    };
  }

  return {
    filenamePrefix: `تقرير-مبيعات-${timeMode === "daily" ? "يومي" : "شهري"}-${dateFrom}-${dateTo}`,
    sheetName: timeMode === "daily" ? "يومي" : "شهري",
    pdfTitle: `تقرير المبيعات ${timeMode === "daily" ? "اليومي" : "الشهري"} (${dateFrom} - ${dateTo})`,
    headers: [
      timeMode === "daily" ? "التاريخ" : "الشهر",
      "عدد الفواتير",
      "المبيعات قبل الضريبة",
      "المرتجعات قبل الضريبة",
      "صافي المبيعات",
      "متوسط الفاتورة",
      "% المرتجعات",
      ...(isPostedOnly ? ["الربح", "الهامش %"] : []),
      "النمو vs السابق",
    ],
    rows: timeData.map((period) => [
      period.label,
      period.count,
      period.total,
      period.returns,
      period.net,
      period.aov,
      period.returns > 0
        ? period.returnRate === null
          ? "مرتجع فقط"
          : formatOptionalPercent(period.returnRate)
        : "—",
      ...(isPostedOnly
        ? [
            period.profit,
            formatOptionalPercent(period.margin),
          ]
        : []),
      period.growth === null
        ? "—"
        : `${period.growth >= 0 ? "+" : ""}${period.growth.toFixed(1)}%`,
    ]),
  };
}
