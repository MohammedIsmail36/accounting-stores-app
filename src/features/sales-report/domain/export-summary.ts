interface SalesExportKpi {
  count: number;
  grossSales: number;
  returnsTotal: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number | null;
  cashCollected: number;
  cashCollectionRate: number | null;
  returnSettled: number;
  totalCovered: number;
}

interface SalesExportSummaryInput {
  kpi: SalesExportKpi;
  overdueInfo: { count: number; total: number };
  discountTaxInfo: { discount: number; tax: number };
  targetInfo: { pct: number } | null;
  customerScope?: string | null;
}

export interface SalesExportSummaryCard {
  label: string;
  value: string;
}

const formatMoney = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatPercent = (value: number | null) =>
  value === null ? "—" : `${value.toFixed(1)}%`;

/** Builds the PDF summary from the same posted-document KPIs shown on screen. */
export function buildSalesExportSummary({
  kpi,
  overdueInfo,
  discountTaxInfo,
  targetInfo,
  customerScope,
}: SalesExportSummaryInput): SalesExportSummaryCard[] {
  return [
    {
      label: "نطاق الملخص المالي",
      value: "المستندات المُرحّلة فقط",
    },
    ...(customerScope
      ? [{ label: "نطاق العميل", value: customerScope }]
      : []),
    { label: "عدد الفواتير", value: String(kpi.count) },
    {
      label: "إجمالي المبيعات قبل الضريبة",
      value: formatMoney(kpi.grossSales),
    },
    {
      label: "المرتجعات قبل الضريبة",
      value: formatMoney(kpi.returnsTotal),
    },
    {
      label: "صافي المبيعات قبل الضريبة",
      value: formatMoney(kpi.netSales),
    },
    { label: "صافي تكلفة البضاعة", value: formatMoney(kpi.cogs) },
    { label: "إجمالي الربح", value: formatMoney(kpi.grossProfit) },
    {
      label: "هامش الربح",
      value: formatPercent(kpi.grossMarginPercent),
    },
    {
      label: "التحصيل النقدي/البنكي المخصص للفواتير",
      value: formatMoney(kpi.cashCollected),
    },
    {
      label: "نسبة التحصيل النقدي من الفواتير شامل الضريبة",
      value: formatPercent(kpi.cashCollectionRate),
    },
    {
      label: "تسويات أرصدة المرتجعات",
      value: formatMoney(kpi.returnSettled),
    },
    {
      label: "إجمالي تغطية الفواتير",
      value: formatMoney(kpi.totalCovered),
    },
    {
      label: "متوسط الفاتورة قبل الضريبة",
      value: formatMoney(kpi.count > 0 ? kpi.grossSales / kpi.count : 0),
    },
    {
      label: "المتأخرات",
      value: `${formatMoney(overdueInfo.total)} (${overdueInfo.count} فاتورة)`,
    },
    {
      label: "إجمالي الخصم",
      value: formatMoney(discountTaxInfo.discount),
    },
    {
      label: "إجمالي الضريبة",
      value: formatMoney(discountTaxInfo.tax),
    },
    ...(targetInfo
      ? [
          {
            label: "تحقيق الهدف",
            value: formatPercent(targetInfo.pct),
          },
        ]
      : []),
  ];
}
