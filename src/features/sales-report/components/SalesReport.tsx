import { useCallback, useState, useMemo } from "react";
import type { SortingState, VisibilityState } from "@tanstack/react-table";
import { useNavigate } from "react-router-dom";
import { getQuickDateRanges } from "@/lib/report-period";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePickerInput } from "@/components/DatePickerInput";
import { DataTable } from "@/components/ui/data-table";
import { ExportMenu } from "@/components/ExportMenu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ColumnDef } from "@tanstack/react-table";
import {
  format,
  startOfMonth,
  endOfMonth,
  subMonths,
} from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
} from "recharts";
import { useSettings } from "@/contexts/SettingsContext";
import {
  TrendingUp,
  TrendingDown,
  Percent,
  AlertTriangle,
  Target,
  ChevronDown,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDisplayNumber } from "@/lib/posted-number-utils";
import {
  getDocumentAmountExcludingTax,
} from "@/features/sales-report/domain/metrics";
import {
  buildOverdueSalesInfo,
  buildSalesDiscountTaxInfo,
  buildSalesTargetInfo,
  getInvoiceCoverage,
} from "@/features/sales-report/domain/insights";
import {
  buildCategorySalesGroups,
  buildCustomerSalesGroups,
  buildProductSalesGroups,
  buildTimeSalesGroups,
} from "@/features/sales-report/domain/grouping";
import { buildSalesReportChart } from "@/features/sales-report/domain/chart";
import { buildSalesExportSummary } from "@/features/sales-report/domain/export-summary";
import { buildAggregateSalesExport } from "@/features/sales-report/domain/aggregate-export";
import {
  buildInvoiceSalesExport,
  buildReturnSalesExport,
} from "@/features/sales-report/domain/document-export";
import { buildSalesInvoiceRowMetrics } from "@/features/sales-report/domain/invoice-row";
import { useSalesReportPreferences } from "@/features/sales-report/hooks/use-sales-report-preferences";
import { useSalesReportData } from "@/features/sales-report/hooks/use-sales-report-data";
import { useSalesReportMetrics } from "@/features/sales-report/hooks/use-sales-report-metrics";
import { QuickSortToolbar } from "./QuickSortToolbar";
import { LookupCombobox } from "@/components/LookupCombobox";
import {
  ALL_CUSTOMERS_FILTER,
  buildSalesCustomerFilterOptions,
  filterSalesDocumentsByCustomer,
} from "@/features/sales-report/domain/customer-filter";
import { calculatePeriodGrowth } from "@/features/sales-report/domain/period-comparison";

// ── helpers ──
const fmt = (n: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const FLAT_ACTION_CLASS =
  "h-9 gap-2 rounded-lg border-0 bg-muted/50 px-3 text-xs font-medium text-foreground shadow-none hover:bg-muted hover:text-foreground";
const FLAT_SEGMENT_CLASS =
  "h-8 rounded-md px-3 text-xs text-muted-foreground shadow-none hover:bg-primary/10 hover:text-primary data-[state=on]:!bg-primary/15 data-[state=on]:!text-primary";
const formatPeriodDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
};

export default function SalesReport() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [dateFrom, setDateFrom] = useState(
    format(startOfMonth(new Date()), "yyyy-MM-dd"),
  );
  const [dateTo, setDateTo] = useState(
    format(endOfMonth(new Date()), "yyyy-MM-dd"),
  );
  const [customerFilter, setCustomerFilter] = useState(
    ALL_CUSTOMERS_FILTER,
  );
  const [customerFilterName, setCustomerFilterName] = useState("كل العملاء");
  const {
    statusFilter,
    setStatusFilter,
    groupBy,
    setGroupBy,
    timeMode,
    setTimeMode,
    comparisonMode,
    setComparisonMode,
  } = useSalesReportPreferences();
  // Secondary indicators start collapsed on every report visit to preserve focus.
  const [showExtras, setShowExtras] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [invoiceSort, setInvoiceSort] = useState<SortingState>([]);
  const [productSort, setProductSort] = useState<SortingState>([]);
  const [invoiceColumnVisibility, setInvoiceColumnVisibility] =
    useState<VisibilityState>({
      cashCollected: false,
      returnSettled: false,
      cogs: false,
    });
  const [returnColumnVisibility, setReturnColumnVisibility] =
    useState<VisibilityState>({ itemsCount: false, documentType: false });
  const [customerColumnVisibility, setCustomerColumnVisibility] =
    useState<VisibilityState>({
      invoiceGrossTotal: false,
      cashCollected: false,
      returnSettled: false,
      remaining: false,
      collection: false,
    });
  const [productColumnVisibility, setProductColumnVisibility] =
    useState<VisibilityState>({
      cogs: false,
    });
  const [categoryColumnVisibility, setCategoryColumnVisibility] =
    useState<VisibilityState>({
      qtySold: false,
      qtyReturned: false,
      revenue: false,
      returns: false,
      returnRate: false,
    });
  const [timeColumnVisibility, setTimeColumnVisibility] =
    useState<VisibilityState>({
      aov: false,
      returnRate: false,
    });

  // ── Quick date presets (طبقة مشتركة) ──
  const quickRanges = useMemo(() => getQuickDateRanges(), []);

  const {
    invoicesQuery,
    returnsQuery,
    movementsQuery,
    paymentAllocationsQuery,
    returnSettlementsQuery,
    summaryQuery,
    invoices: unfilteredInvoices,
    returns: unfilteredReturns,
    movements,
    paymentAllocations,
    returnSettlements,
  } = useSalesReportData(
    dateFrom,
    dateTo,
    customerFilter === ALL_CUSTOMERS_FILTER ? null : customerFilter,
    comparisonMode,
  );

  const customerFilterOptions = useMemo(
    () => {
      const options = buildSalesCustomerFilterOptions(
        unfilteredInvoices,
        unfilteredReturns,
      );
      return options.some(({ id }) => id === customerFilter)
        ? options
        : [...options, { id: customerFilter, name: customerFilterName }];
    },
    [
      unfilteredInvoices,
      unfilteredReturns,
      customerFilter,
      customerFilterName,
    ],
  );
  const selectedCustomerFilter = customerFilterOptions.find(
    ({ id }) => id === customerFilter,
  );
  const invoices = useMemo(
    () =>
      filterSalesDocumentsByCustomer(unfilteredInvoices, customerFilter),
    [unfilteredInvoices, customerFilter],
  );
  const returns = useMemo(
    () => filterSalesDocumentsByCustomer(unfilteredReturns, customerFilter),
    [unfilteredReturns, customerFilter],
  );

  const {
    detailInvoices,
    financialInvoices,
    detailReturns,
    financialReturns,
    financialMovements,
    invoiceCoverage,
    kpi,
    prevKpi,
    cogsByInvoice,
  } = useSalesReportMetrics({
    invoices,
    returns,
    movements,
    paymentAllocations,
    returnSettlements,
    statusFilter,
    serverSummary: summaryQuery.data,
  });

  const GrowthBadge = ({
    current,
    previous,
  }: {
    current: number;
    previous: number;
  }) => {
    if (isLoading) return null;
    if (previous === 0 && current === 0) return null;
    const growth = calculatePeriodGrowth(current, previous);
    if (growth === null) {
      return (
        <span className="text-[10px] font-medium text-muted-foreground">
          لا توجد بيانات سابقة
        </span>
      );
    }
    return (
      <span
        className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${growth >= 0 ? "text-emerald-600" : "text-destructive"}`}
      >
        {growth >= 0 ? (
          <TrendingUp className="w-3 h-3" />
        ) : (
          <TrendingDown className="w-3 h-3" />
        )}
        {growth >= 0 ? "+" : ""}
        {growth.toFixed(1)}%
      </span>
    );
  };

  const today = format(new Date(), "yyyy-MM-dd");

  // ── Sales target ──
  const targetInfo = useMemo(
    () =>
      buildSalesTargetInfo(
        settings?.monthly_sales_target,
        dateFrom,
        dateTo,
        kpi.netSales,
        today,
      ),
    [settings?.monthly_sales_target, dateFrom, dateTo, kpi.netSales, today],
  );

  // ── Overdue check ──
  const getCoverage = useCallback(
    (invoiceId: string) =>
      getInvoiceCoverage(invoiceId, invoiceCoverage.byInvoice),
    [invoiceCoverage],
  );
  const getInvoiceRowMetrics = useCallback(
    (invoice: any) =>
      buildSalesInvoiceRowMetrics(
        invoice,
        cogsByInvoice,
        invoiceCoverage.byInvoice,
        today,
      ),
    [cogsByInvoice, invoiceCoverage.byInvoice, today],
  );

  const overdueInfo = useMemo(
    () => buildOverdueSalesInfo(invoices, invoiceCoverage.byInvoice, today),
    [invoices, invoiceCoverage.byInvoice, today],
  );

  const discountTaxInfo = useMemo(
    () => buildSalesDiscountTaxInfo(invoices),
    [invoices],
  );

  // ═══ GROUPING: By Invoice ═══
  const invoiceColumns = useMemo<ColumnDef<any, any>[]>(
    () => [
      {
        accessorKey: "invoice_number",
        header: "رقم الفاتورة",
        cell: ({ row }) => {
          const inv = row.original;
          const display = formatDisplayNumber(
            settings?.sales_invoice_prefix || "INV-",
            inv.posted_number,
            inv.invoice_number,
            inv.status,
          );
          return (
            <button
              className="text-primary hover:underline font-mono font-medium"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/sales/${inv.id}`);
              }}
            >
              {display}
            </button>
          );
        },
        footer: () => <span className="font-bold">الإجمالي</span>,
      },
      { accessorKey: "invoice_date", header: "التاريخ" },
      {
        id: "customer",
        header: "العميل",
        accessorFn: (row: any) => row.customer?.name || "عميل نقدي",
      },
      {
        accessorKey: "status",
        header: "الحالة",
        cell: ({ row }) => {
          const s = row.original.status;
          return (
            <Badge
              variant={
                s === "posted"
                  ? "default"
                  : s === "cancelled"
                    ? "destructive"
                    : "secondary"
              }
            >
              {s === "posted" ? "مُرحّل" : s === "cancelled" ? "ملغي" : "مسودة"}
            </Badge>
          );
        },
      },
      {
        id: "total",
        header: "الإجمالي",
        accessorFn: (r: any) => getInvoiceRowMetrics(r).total,
        cell: ({ getValue }) => fmt(getValue() as number),
        footer: ({ table }) => {
          const total = table
            .getFilteredRowModel()
            .rows.reduce(
              (sum, row) => sum + getInvoiceRowMetrics(row.original).total,
              0,
            );
          return <span className="font-bold font-mono">{fmt(total)}</span>;
        },
      },
      {
        id: "cashCollected",
        header: "تحصيل نقدي/بنكي",
        accessorFn: (r: any) => getInvoiceRowMetrics(r).coverage.cashCollected,
        cell: ({ getValue }) => fmt(getValue() as number),
        footer: ({ table }) => {
          const total = table
            .getFilteredRowModel()
            .rows.reduce(
              (sum, row) =>
                sum + getInvoiceRowMetrics(row.original).coverage.cashCollected,
              0,
            );
          return <span className="font-mono">{fmt(total)}</span>;
        },
      },
      {
        id: "returnSettled",
        header: "تسوية بمرتجع",
        accessorFn: (r: any) => getInvoiceRowMetrics(r).coverage.returnSettled,
        cell: ({ getValue }) => fmt(getValue() as number),
        footer: ({ table }) => (
          <span className="font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce(
                  (sum, row) =>
                    sum + getInvoiceRowMetrics(row.original).coverage.returnSettled,
                  0,
                ),
            )}
          </span>
        ),
      },
      {
        id: "remaining",
        header: "المتبقي",
        accessorFn: (r: any) => getInvoiceRowMetrics(r).remaining,
        cell: ({ getValue, row }) => {
          const v = getValue() as number;
          return (
            <div className="flex items-center gap-1.5">
              <span className={v > 0 ? "text-destructive font-medium" : ""}>
                {fmt(v)}
              </span>
              {getInvoiceRowMetrics(row.original).overdue && (
                <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                  <AlertTriangle className="me-0.5 h-3 w-3" />
                  متأخر
                </Badge>
              )}
            </div>
          );
        },
        footer: ({ table }) => {
          const total = table
            .getFilteredRowModel()
            .rows.reduce(
              (sum, row) =>
                sum + getInvoiceRowMetrics(row.original).remaining,
              0,
            );
          return (
            <span className="font-mono text-destructive">{fmt(total)}</span>
          );
        },
      },
      {
        id: "cogs",
        header: "تكلفة البضاعة",
        accessorFn: (r: any) => getInvoiceRowMetrics(r).cogs,
        cell: ({ getValue }) => (
          <span className="font-mono">{fmt(getValue() as number)}</span>
        ),
        footer: ({ table }) => {
          const total = table
            .getFilteredRowModel()
            .rows.reduce(
              (sum, row) => sum + getInvoiceRowMetrics(row.original).cogs,
              0,
            );
          return <span className="font-mono">{fmt(total)}</span>;
        },
      },
      {
        id: "profit",
        header: "الربح قبل المرتجعات المستقلة",
        accessorFn: (r: any) => getInvoiceRowMetrics(r).profit ?? 0,
        cell: ({ row }) => {
          const profit = getInvoiceRowMetrics(row.original).profit;
          if (profit === null)
            return <span className="text-muted-foreground">—</span>;
          return (
            <span
              className={`font-mono ${profit < 0 ? "text-destructive" : "text-emerald-600"}`}
            >
              {fmt(profit)}
            </span>
          );
        },
        footer: ({ table }) => {
          const total = table
            .getFilteredRowModel()
            .rows.reduce(
              (sum, row) =>
                sum + (getInvoiceRowMetrics(row.original).profit ?? 0),
              0,
            );
          return (
            <span className="font-bold font-mono">{fmt(total)}</span>
          );
        },
      },
      {
        id: "margin",
        header: "الهامش%",
        accessorFn: (r: any) => getInvoiceRowMetrics(r).margin ?? 0,
        cell: ({ row }) => {
          const margin = getInvoiceRowMetrics(row.original).margin;
          if (margin === null)
            return (
              <span className="text-muted-foreground" title="لا توجد تكلفة مسجّلة لهذه الفاتورة">
                —
              </span>
            );
          return <span className="font-mono">{margin.toFixed(1)}%</span>;
        },
      },
    ],
    [navigate, getInvoiceRowMetrics, settings?.sales_invoice_prefix],
  );

  // ═══ STANDALONE SALES RETURNS ═══
  const returnColumns = useMemo<ColumnDef<any, any>[]>(
    () => [
      {
        accessorKey: "return_number",
        header: "رقم المرتجع",
        cell: ({ row }) => {
          const ret = row.original;
          const display = formatDisplayNumber(
            settings?.sales_return_prefix || "SRN-",
            ret.posted_number,
            ret.return_number,
            ret.status,
          );
          return (
            <button
              className="text-primary hover:underline font-mono font-medium"
              onClick={(event) => {
                event.stopPropagation();
                navigate(`/sales-returns/${ret.id}`);
              }}
            >
              {display}
            </button>
          );
        },
        footer: () => <span className="font-bold">الإجمالي</span>,
      },
      { accessorKey: "return_date", header: "التاريخ" },
      {
        accessorKey: "status",
        header: "الحالة",
        cell: ({ getValue }) => {
          const status = getValue() as string;
          return (
            <Badge
              variant="outline"
              className={
                status === "posted"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                  : status === "cancelled"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700"
              }
            >
              {status === "posted"
                ? "مُرحّل"
                : status === "cancelled"
                  ? "ملغي"
                  : "مسودة"}
            </Badge>
          );
        },
      },
      {
        id: "customer",
        header: "العميل",
        accessorFn: (row: any) => row.customer?.name || "عميل نقدي",
      },
      {
        id: "itemsCount",
        header: "عدد البنود",
        accessorFn: (row: any) => (row.items || []).length,
        footer: ({ table }) =>
          table
            .getFilteredRowModel()
            .rows.reduce((sum, row) => sum + (row.original.items || []).length, 0),
      },
      {
        id: "amountExcludingTax",
        header: "المرتجع قبل الضريبة",
        accessorFn: (row: any) => getDocumentAmountExcludingTax(row),
        cell: ({ getValue }) => (
          <span className="font-mono text-destructive">
            {fmt(getValue() as number)}
          </span>
        ),
        footer: ({ table }) => (
          <span className="font-bold font-mono text-destructive">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce(
                  (sum, row) =>
                    sum + getDocumentAmountExcludingTax(row.original),
                  0,
                ),
            )}
          </span>
        ),
      },
      {
        id: "documentType",
        header: "النوع",
        cell: () => (
          <Badge variant="outline" className="text-destructive border-destructive/30">
            مستند مستقل
          </Badge>
        ),
      },
    ],
    [navigate, settings?.sales_return_prefix],
  );

  // ═══ GROUPING: By Customer ═══
  const customerData = useMemo(
    () =>
      buildCustomerSalesGroups(
        financialInvoices,
        financialReturns,
        getCoverage,
      ),
    [financialInvoices, financialReturns, getCoverage],
  );

  const customerColumns = useMemo<ColumnDef<any, any>[]>(
    () => [
      {
        accessorKey: "name",
        header: "العميل",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span>{row.original.name}</span>
            {row.original.returnOnly && (
              <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">
                مرتجع فقط
              </Badge>
            )}
          </div>
        ),
        footer: () => <span className="font-bold">الإجمالي</span>,
      },
      {
        accessorKey: "count",
        header: "عدد الفواتير",
        footer: ({ table }) =>
          table
            .getFilteredRowModel()
            .rows.reduce((s, r) => s + r.original.count, 0),
      },
      {
        accessorKey: "total",
        header: "المبيعات قبل الضريبة",
        cell: ({ getValue }) => fmt(getValue() as number),
        footer: ({ table }) => (
          <span className="font-bold font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce((s, r) => s + r.original.total, 0),
            )}
          </span>
        ),
      },
      {
        accessorKey: "returns",
        header: "المرتجعات",
        cell: ({ getValue }) => (
          <span className="text-destructive">{fmt(getValue() as number)}</span>
        ),
        footer: ({ table }) => (
          <span className="text-destructive font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce((s, r) => s + r.original.returns, 0),
            )}
          </span>
        ),
      },
      {
        id: "net",
        header: "الصافي",
        accessorFn: (r: any) => r.total - r.returns,
        cell: ({ getValue }) => fmt(getValue() as number),
        footer: ({ table }) => (
          <span className="font-bold font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce(
                  (s, r) => s + r.original.total - r.original.returns,
                  0,
                ),
            )}
          </span>
        ),
      },
      {
        accessorKey: "invoiceGrossTotal",
        header: "الفواتير شامل الضريبة",
        cell: ({ getValue }) => fmt(getValue() as number),
        footer: ({ table }) => (
          <span className="font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce((s, r) => s + r.original.invoiceGrossTotal, 0),
            )}
          </span>
        ),
      },
      {
        accessorKey: "cashCollected",
        header: "تحصيل نقدي/بنكي",
        cell: ({ getValue }) => fmt(getValue() as number),
        footer: ({ table }) => (
          <span className="font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce((s, r) => s + r.original.cashCollected, 0),
            )}
          </span>
        ),
      },
      {
        accessorKey: "returnSettled",
        header: "تسوية بمرتجع",
        cell: ({ getValue }) => fmt(getValue() as number),
        footer: ({ table }) => (
          <span className="font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce((s, r) => s + r.original.returnSettled, 0),
            )}
          </span>
        ),
      },
      {
        id: "remaining",
        header: "المتبقي",
        accessorFn: (r: any) =>
          r.invoiceGrossTotal - r.cashCollected - r.returnSettled,
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <span className={v > 0 ? "text-destructive" : ""}>{fmt(v)}</span>
          );
        },
        footer: ({ table }) => {
          const t = table
            .getFilteredRowModel()
            .rows.reduce(
              (s, r) =>
                s +
                r.original.invoiceGrossTotal -
                r.original.cashCollected -
                r.original.returnSettled,
              0,
            );
          return <span className="text-destructive font-mono">{fmt(t)}</span>;
        },
      },
      {
        id: "collection",
        header: "التحصيل النقدي%",
        accessorFn: (r: any) => {
          return r.invoiceGrossTotal > 0
            ? (r.cashCollected / r.invoiceGrossTotal) * 100
            : null;
        },
        cell: ({ getValue }) => {
          const value = getValue() as number | null;
          return (
            <span className="font-mono">
              {value === null ? "—" : `${value.toFixed(1)}%`}
            </span>
          );
        },
      },
    ],
    [],
  );

  // ═══ GROUPING: By Product ═══
  const productData = useMemo(
    () =>
      buildProductSalesGroups(
        financialInvoices,
        financialReturns,
        financialMovements,
      ),
    [financialInvoices, financialReturns, financialMovements],
  );

  const productColumns = useMemo<ColumnDef<any, any>[]>(
    () => [
      {
        accessorKey: "name",
        header: "المنتج",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span>{row.original.name}</span>
            {row.original.returnOnly && (
              <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">
                مرتجع فقط
              </Badge>
            )}
            {row.original.reconciliationStatus === "fully_returned" && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                بيع ومرتجع بالكامل
              </Badge>
            )}
            {row.original.reconciliationStatus ===
              "return_price_difference" && (
              <Badge
                variant="outline"
                className="text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-700"
              >
                فرق سعر مرتجع
              </Badge>
            )}
          </div>
        ),
        footer: () => <span className="font-bold">الإجمالي</span>,
      },
      {
        accessorKey: "qtySold",
        header: "الكمية المباعة",
        footer: ({ table }) =>
          table
            .getFilteredRowModel()
            .rows.reduce((s, r) => s + r.original.qtySold, 0),
      },
      {
        accessorKey: "qtyReturned",
        header: "المرتجع",
        cell: ({ getValue }) => (
          <span className="text-destructive">{getValue() as number}</span>
        ),
        footer: ({ table }) => (
          <span className="text-destructive">
            {table
              .getFilteredRowModel()
              .rows.reduce((s, r) => s + r.original.qtyReturned, 0)}
          </span>
        ),
      },
      {
        id: "netQty",
        header: "صافي الكمية",
        accessorFn: (r: any) => r.qtySold - r.qtyReturned,
        footer: ({ table }) =>
          table
            .getFilteredRowModel()
            .rows.reduce(
              (s, r) => s + r.original.qtySold - r.original.qtyReturned,
              0,
            ),
      },
      {
        accessorKey: "revenue",
        header: "الإيرادات الصافية",
        cell: ({ row }) => {
          const r = row.original;
          const v = r.revenue;
          return (
            <span
              className="font-mono"
              title={
                r.returnsRevenue > 0
                  ? `الإجمالي: ${fmt(r.grossRevenue)} − المرتجعات: ${fmt(r.returnsRevenue)}`
                  : undefined
              }
            >
              {fmt(v)}
            </span>
          );
        },
        footer: ({ table }) => (
          <span className="font-bold font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce((s, r) => s + r.original.revenue, 0),
            )}
          </span>
        ),
      },

      {
        accessorKey: "cogs",
        header: "التكلفة",
        cell: ({ getValue }) => fmt(getValue() as number),
        footer: ({ table }) => (
          <span className="font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce((s, r) => s + r.original.cogs, 0),
            )}
          </span>
        ),
      },
      {
        id: "profit",
        header: "الربح",
        accessorFn: (r: any) => r.revenue - r.cogs,
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <span className={v < 0 ? "text-destructive" : "text-emerald-600"}>
              {fmt(v)}
            </span>
          );
        },
        footer: ({ table }) => {
          const t = table
            .getFilteredRowModel()
            .rows.reduce((s, r) => s + r.original.revenue - r.original.cogs, 0);
          return <span className="font-bold font-mono">{fmt(t)}</span>;
        },
      },
      {
        id: "margin",
        header: "الهامش%",
        accessorFn: (r: any) =>
          r.revenue > 0 && r.cogs > 0
            ? ((r.revenue - r.cogs) / r.revenue) * 100
            : null,
        cell: ({ row }) => {
          const r = row.original;
          if (!(r.revenue > 0) || !(r.cogs > 0)) {
            const reason =
              r.revenue === 0
                ? "لا يُحسب الهامش عندما يكون صافي الإيراد صفراً"
                : r.revenue < 0
                  ? "لا يُحسب الهامش عندما يكون صافي الإيراد سالباً"
                  : "لا توجد تكلفة صافية موجبة لهذا المنتج";
            return (
              <span className="text-muted-foreground" title={reason}>
                —
              </span>
            );
          }
          const v = ((r.revenue - r.cogs) / r.revenue) * 100;
          return <span className="font-mono">{v.toFixed(1)}%</span>;
        },
      },

    ],
    [],
  );

  // ═══ GROUPING: By Time ═══
  const timeData = useMemo(
    () =>
      buildTimeSalesGroups(
        financialInvoices,
        financialReturns,
        financialMovements,
        timeMode,
        true,
      ),
    [financialInvoices, financialReturns, financialMovements, timeMode],
  );

  const timeColumns = useMemo<ColumnDef<any, any>[]>(() => {
    const cols: ColumnDef<any, any>[] = [
      {
        accessorKey: "label",
        header: timeMode === "daily" ? "التاريخ" : "الشهر",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span>{row.original.label}</span>
            {row.original.returnOnly && (
              <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">
                مرتجع فقط
              </Badge>
            )}
          </div>
        ),
        footer: () => <span className="font-bold">الإجمالي</span>,
      },
      {
        accessorKey: "count",
        header: "عدد الفواتير",
        footer: ({ table }) =>
          table
            .getFilteredRowModel()
            .rows.reduce((s, r) => s + r.original.count, 0),
      },
      {
        accessorKey: "total",
        header: "المبيعات قبل الضريبة",
        cell: ({ getValue }) => fmt(getValue() as number),
        footer: ({ table }) => (
          <span className="font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce((sum, row) => sum + row.original.total, 0),
            )}
          </span>
        ),
      },
      {
        accessorKey: "returns",
        header: "المرتجعات قبل الضريبة",
        cell: ({ getValue }) => (
          <span className="text-destructive font-mono">
            {fmt(getValue() as number)}
          </span>
        ),
        footer: ({ table }) => (
          <span className="text-destructive font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce((sum, row) => sum + row.original.returns, 0),
            )}
          </span>
        ),
      },
      {
        accessorKey: "net",
        header: "صافي المبيعات",
        cell: ({ getValue }) => (
          <span className="font-bold font-mono">
            {fmt(getValue() as number)}
          </span>
        ),
        footer: ({ table }) => (
          <span className="font-bold font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce((s, r) => s + r.original.net, 0),
            )}
          </span>
        ),
      },
      {
        accessorKey: "aov",
        header: "متوسط الفاتورة",
        cell: ({ getValue }) => (
          <span className="font-mono text-muted-foreground">
            {fmt(getValue() as number)}
          </span>
        ),
      },
      {
        accessorKey: "returnRate",
        header: "% المرتجعات",
        cell: ({ getValue, row }) => {
          const v = getValue() as number | null;
          const ret = row.original.returns;
          if (ret <= 0)
            return <span className="text-muted-foreground">—</span>;
          if (v === null)
            return (
              <span className="text-destructive" title="مرتجعات بلا مبيعات في الفترة">
                مرتجع فقط
              </span>
            );
          const tone =
            v >= 10
              ? "text-destructive"
              : v >= 5
                ? "text-amber-600"
                : "text-muted-foreground";
          return (
            <span className={`font-mono ${tone}`}>{v.toFixed(1)}%</span>
          );
        },
      },
    ];
    cols.push(
        {
          accessorKey: "profit",
          header: "الربح",
          cell: ({ getValue }) => {
            const v = getValue() as number;
            return (
              <span
                className={`font-mono font-semibold ${v >= 0 ? "text-emerald-600" : "text-destructive"}`}
              >
                {fmt(v)}
              </span>
            );
          },
          footer: ({ table }) => {
            const v = table
              .getFilteredRowModel()
              .rows.reduce((s, r) => s + r.original.profit, 0);
            return (
              <span className="font-bold font-mono">{fmt(v)}</span>
            );
          },
        },
        {
          accessorKey: "margin",
          header: "الهامش %",
          cell: ({ getValue }) => {
            const v = getValue() as number | null;
            if (v === null)
              return <span className="text-muted-foreground">—</span>;
            const tone =
              v >= 25
                ? "text-emerald-600"
                : v >= 10
                  ? "text-amber-600"
                  : "text-destructive";
            return (
              <span className={`font-mono ${tone}`}>{v.toFixed(1)}%</span>
            );
          },
        },
      );
    cols.push({
      accessorKey: "growth",
      header: "النمو vs السابق",
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        if (v === null)
          return <span className="text-muted-foreground">—</span>;
        const tone = v >= 0 ? "text-emerald-600" : "text-destructive";
        const arrow = v >= 0 ? "▲" : "▼";
        return (
          <span className={`font-mono ${tone}`}>
            {arrow} {Math.abs(v).toFixed(1)}%
          </span>
        );
      },
    });
    return cols;
  }, [timeMode]);

  // ═══ GROUPING: By Category ═══
  const categoryData = useMemo(
    () =>
      buildCategorySalesGroups(
        financialInvoices,
        financialReturns,
        financialMovements,
        true,
      ),
    [financialInvoices, financialReturns, financialMovements],
  );

  const categoryColumns = useMemo<ColumnDef<any, any>[]>(() => {
    const cols: ColumnDef<any, any>[] = [
      {
        accessorKey: "name",
        header: "التصنيف",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span>{row.original.name}</span>
            {row.original.returnOnly && (
              <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">
                مرتجع فقط
              </Badge>
            )}
          </div>
        ),
        footer: () => <span className="font-bold">الإجمالي</span>,
      },
      {
        accessorKey: "productCount",
        header: "منتجات",
        footer: ({ table }) =>
          table
            .getFilteredRowModel()
            .rows.reduce((s, r) => s + r.original.productCount, 0),
      },
      {
        accessorKey: "qtySold",
        header: "الكمية المباعة",
        footer: ({ table }) =>
          table
            .getFilteredRowModel()
            .rows.reduce((s, r) => s + r.original.qtySold, 0),
      },
      {
        accessorKey: "qtyReturned",
        header: "الكمية المرتجعة",
        cell: ({ getValue }) => (
          <span className="text-destructive">{getValue() as number}</span>
        ),
        footer: ({ table }) =>
          table
            .getFilteredRowModel()
            .rows.reduce((s, r) => s + r.original.qtyReturned, 0),
      },
      {
        accessorKey: "revenue",
        header: "المبيعات",
        cell: ({ getValue }) => fmt(getValue() as number),
        footer: ({ table }) => (
          <span className="font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce((sum, row) => sum + row.original.revenue, 0),
            )}
          </span>
        ),
      },
      {
        accessorKey: "returns",
        header: "المرتجعات",
        cell: ({ getValue }) => (
          <span className="text-destructive font-mono">
            {fmt(getValue() as number)}
          </span>
        ),
        footer: ({ table }) => (
          <span className="text-destructive font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce((sum, row) => sum + row.original.returns, 0),
            )}
          </span>
        ),
      },
      {
        accessorKey: "net",
        header: "صافي الإيرادات",
        cell: ({ getValue }) => (
          <span className="font-bold font-mono">
            {fmt(getValue() as number)}
          </span>
        ),
        footer: ({ table }) => (
          <span className="font-bold font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce((s, r) => s + r.original.net, 0),
            )}
          </span>
        ),
      },
      {
        accessorKey: "returnRate",
        header: "% المرتجعات",
        cell: ({ getValue, row }) => {
          const v = getValue() as number | null;
          if (row.original.returns <= 0)
            return <span className="text-muted-foreground">—</span>;
          if (v === null)
            return (
              <span className="text-destructive" title="مرتجعات بلا مبيعات في التصنيف">
                مرتجع فقط
              </span>
            );
          const tone =
            v >= 10
              ? "text-destructive"
              : v >= 5
                ? "text-amber-600"
                : "text-muted-foreground";
          return (
            <span className={`font-mono ${tone}`}>{v.toFixed(1)}%</span>
          );
        },
      },
    ];
    cols.push(
        {
          accessorKey: "profit",
          header: "الربح",
          cell: ({ getValue }) => {
            const v = getValue() as number;
            return (
              <span
                className={`font-mono font-semibold ${v >= 0 ? "text-emerald-600" : "text-destructive"}`}
              >
                {fmt(v)}
              </span>
            );
          },
          footer: ({ table }) => {
            const v = table
              .getFilteredRowModel()
              .rows.reduce((s, r) => s + r.original.profit, 0);
            return (
              <span className="font-bold font-mono">{fmt(v)}</span>
            );
          },
        },
        {
          accessorKey: "margin",
          header: "الهامش %",
          cell: ({ getValue }) => {
            const v = getValue() as number | null;
            if (v === null)
              return <span className="text-muted-foreground">—</span>;
            const tone =
              v >= 25
                ? "text-emerald-600"
                : v >= 10
                  ? "text-amber-600"
                  : "text-destructive";
            return (
              <span className={`font-mono ${tone}`}>{v.toFixed(1)}%</span>
            );
          },
        },
      );
    cols.push({
      accessorKey: "pctOfTotal",
      header: "% المساهمة",
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-muted rounded overflow-hidden min-w-[40px]">
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.max(0, Math.min(v, 100))}%` }}
              />
            </div>
            <span className="font-mono text-xs w-12 text-left">
              {v.toFixed(1)}%
            </span>
          </div>
        );
      },
    });
    return cols;
  }, []);

  // ── One decision-oriented chart for the active aggregate view ──
  const { meta: chartMeta, data: chartData } = useMemo(
    () =>
      buildSalesReportChart({
        groupBy,
        timeMode,
        timeData,
        customerData,
        productData,
        categoryData,
      }),
    [groupBy, timeMode, timeData, customerData, productData, categoryData],
  );

  // ── Export config ──
  const exportConfig = useMemo(() => {
    const detailStatusLabel =
      statusFilter === "all"
        ? "كل الحالات"
        : statusFilter === "posted"
          ? "المُرحّلة فقط"
          : statusFilter === "cancelled"
            ? "الملغاة فقط"
            : "المسودات فقط";
    const summaryCards = buildSalesExportSummary({
      kpi,
      overdueInfo,
      discountTaxInfo,
      targetInfo,
      customerScope:
        customerFilter === ALL_CUSTOMERS_FILTER
          ? null
          : selectedCustomerFilter?.name || "العميل المحدد",
    });

    if (groupBy === "invoice") {
      return {
        ...buildInvoiceSalesExport({
          invoices: detailInvoices,
          dateFrom,
          dateTo,
          invoicePrefix: settings?.sales_invoice_prefix || "INV-",
          cogsByInvoice,
          coverageByInvoice: invoiceCoverage.byInvoice,
          today,
          detailStatusLabel,
        }),
        summaryCards,
        settings,
      };
    }
    if (groupBy === "return") {
      return {
        ...buildReturnSalesExport({
          returns: detailReturns,
          dateFrom,
          dateTo,
          returnPrefix: settings?.sales_return_prefix || "SRN-",
          detailStatusLabel,
        }),
        summaryCards,
        settings,
      };
    }
    return {
      ...buildAggregateSalesExport({
        groupBy,
        dateFrom,
        dateTo,
        timeMode,
        isPostedOnly: true,
        customerData,
        productData,
        categoryData,
        timeData,
      }),
      summaryCards,
      settings,
    };
  }, [
    groupBy,
    detailInvoices,
    detailReturns,
    customerData,
    productData,
    categoryData,
    timeData,
    kpi,
    dateFrom,
    dateTo,
    settings,
    timeMode,
    overdueInfo,
    discountTaxInfo,
    targetInfo,
    cogsByInvoice,
    invoiceCoverage.byInvoice,
    today,
    statusFilter,
    customerFilter,
    selectedCustomerFilter?.name,
  ]);

  const reportQueries = [
    invoicesQuery,
    returnsQuery,
    movementsQuery,
    paymentAllocationsQuery,
    returnSettlementsQuery,
    summaryQuery,
  ];
  const isLoading = reportQueries.some((query) => query.isLoading);
  const queryError = reportQueries.find((query) => query.error)?.error;
  const isRetrying = reportQueries.some((query) => query.isFetching);

  if (queryError) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <div>
            <p className="font-medium text-destructive">
              تعذر تحميل تقرير المبيعات كاملاً
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              لم نعرض نتائج جزئية حتى لا تكون المؤشرات المالية مضللة.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={isRetrying}
            onClick={() => {
              void Promise.all(reportQueries.map((query) => query.refetch()));
            }}
          >
            {isRetrying ? "جارٍ إعادة المحاولة..." : "إعادة المحاولة"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5 p-1">
      {/* ── Unified report controls ── */}
      <Card className="border shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-2.5 p-3">
            <div className="me-1 min-w-[185px]">
              <p className="text-sm font-semibold">نطاق التقرير</p>
              <p className="mt-0.5 whitespace-nowrap text-[11px] text-muted-foreground">
                {formatPeriodDate(dateFrom)} — {formatPeriodDate(dateTo)}
              </p>
            </div>

            <div className="grid min-w-0 flex-1 basis-[310px] grid-cols-[minmax(130px,1fr)_auto_minmax(130px,1fr)] items-center gap-2 sm:max-w-[370px]">
              <DatePickerInput
                value={dateFrom}
                onChange={setDateFrom}
                placeholder="من تاريخ"
                className="h-9 min-w-0 border-0 bg-muted/50 px-2.5 shadow-none hover:bg-muted sm:px-3"
              />
              <span className="text-muted-foreground/40">—</span>
              <DatePickerInput
                value={dateTo}
                onChange={setDateTo}
                placeholder="إلى تاريخ"
                className="h-9 min-w-0 border-0 bg-muted/50 px-2.5 shadow-none hover:bg-muted sm:px-3"
              />
            </div>

            <div className="hidden h-7 w-px bg-border lg:block" />

            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap text-[11px] font-medium text-muted-foreground">
                العميل
              </span>
              <LookupCombobox
                items={customerFilterOptions}
                value={customerFilter}
                onValueChange={(value) => {
                  setCustomerFilter(value);
                  setCustomerFilterName(
                    customerFilterOptions.find(({ id }) => id === value)
                      ?.name || "العميل المحدد",
                  );
                }}
                placeholder="كل العملاء"
                searchPlaceholder="ابحث عن عميل..."
                emptyMessage="لا يوجد عميل في الفترة."
                className="h-9 w-[190px] border-0 bg-muted/50 shadow-none hover:bg-muted"
                disabled={isLoading}
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap text-[11px] font-medium text-muted-foreground">
                المقارنة
              </span>
              <Select
                value={comparisonMode}
                onValueChange={(value) =>
                  setComparisonMode(value as "previous_period" | "previous_year")
                }
              >
                <SelectTrigger className="h-9 w-[155px] border-0 bg-muted/50 font-medium shadow-none hover:bg-muted">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="previous_period">الفترة السابقة</SelectItem>
                  <SelectItem value="previous_year">نفس الفترة من العام السابق</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {groupBy === "invoice" || groupBy === "return" ? (
              <div className="flex items-center gap-2">
                <span className="whitespace-nowrap text-[11px] font-medium text-muted-foreground">حالة المستندات</span>
                <Select
                  value={statusFilter}
                  onValueChange={(v: any) => setStatusFilter(v)}
                >
                  <SelectTrigger className="h-9 w-[120px] border-0 bg-muted/50 font-medium shadow-none hover:bg-muted">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="posted">مُرحّل</SelectItem>
                    <SelectItem value="draft">مسودة</SelectItem>
                    <SelectItem value="cancelled">ملغي</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <Badge variant="outline" className="h-8 bg-muted/30 px-3 text-[11px] font-medium text-muted-foreground">
                التحليل المالي: المُرحّلة فقط
              </Badge>
            )}

            <div className="ms-auto shrink-0">
              <ExportMenu
                config={exportConfig}
                disabled={isLoading}
                buttonClassName="h-9 border-0 bg-primary/10 text-primary shadow-none hover:bg-primary/15 hover:text-primary"
              />
            </div>
          </div>

          <div className="rounded-b-lg border-t bg-muted/10 px-3 py-2">
            <div className="overflow-x-auto">
              <div className="flex w-max min-w-full items-center gap-4">
                <div className="flex items-center gap-2 rounded-lg bg-background/70 p-1">
                  <span className="shrink-0 px-2 text-xs font-semibold text-foreground">فترة سريعة</span>
                  <div className="flex w-max items-center gap-1 rounded-lg bg-muted/50 p-1">
                    {quickRanges.map((p) => (
                      <Button
                        key={p.label}
                        variant="ghost"
                        size="sm"
                        className={`h-7 rounded-md px-2.5 text-xs text-muted-foreground shadow-none hover:bg-primary/10 hover:text-primary ${
                          dateFrom === p.from && dateTo === p.to
                            ? "!bg-primary/15 !text-primary"
                            : ""
                        }`}
                        onClick={() => {
                          setDateFrom(p.from);
                          setDateTo(p.to);
                        }}
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="mx-1 h-8 w-px shrink-0 bg-border" />

                <div className="flex items-center gap-2 rounded-lg bg-background/70 p-1">
                  <span className="shrink-0 px-2 text-xs font-semibold text-foreground">عرض التقرير</span>
                  <ToggleGroup
                    type="single"
                    value={groupBy}
                    onValueChange={(v) => v && setGroupBy(v as any)}
                    className="rounded-lg bg-muted/50 p-1"
                  >
                    <ToggleGroupItem value="invoice" className={FLAT_SEGMENT_CLASS}>الفواتير</ToggleGroupItem>
                    <ToggleGroupItem value="return" className={FLAT_SEGMENT_CLASS}>المرتجعات</ToggleGroupItem>
                    <ToggleGroupItem value="customer" className={FLAT_SEGMENT_CLASS}>العملاء</ToggleGroupItem>
                    <ToggleGroupItem value="product" className={FLAT_SEGMENT_CLASS}>المنتجات</ToggleGroupItem>
                    <ToggleGroupItem value="category" className={FLAT_SEGMENT_CLASS}>التصنيفات</ToggleGroupItem>
                    <ToggleGroupItem value="time" className={FLAT_SEGMENT_CLASS}>زمني</ToggleGroupItem>
                  </ToggleGroup>
                  {groupBy === "time" && (
                    <ToggleGroup
                      type="single"
                      value={timeMode}
                      onValueChange={(v) => v && setTimeMode(v as any)}
                      className="rounded-lg bg-muted/50 p-1"
                    >
                      <ToggleGroupItem value="daily" className={FLAT_SEGMENT_CLASS}>يومي</ToggleGroupItem>
                      <ToggleGroupItem value="monthly" className={FLAT_SEGMENT_CLASS}>شهري</ToggleGroupItem>
                    </ToggleGroup>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Unified period summary ── */}
      <Card className="overflow-hidden border shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/15 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">ملخص الفترة</span>
            <Badge variant="outline" className="h-5 bg-background text-[10px]">
              المستندات المُرحّلة فقط
            </Badge>
            {customerFilter !== ALL_CUSTOMERS_FILTER && (
              <Badge variant="outline" className="h-5 bg-primary/5 text-[10px] text-primary">
                العميل: {selectedCustomerFilter?.name || "المحدد"}
              </Badge>
            )}
          </div>
        </div>
        <CardContent className="p-0">
          <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-5">
        {/* صافي المبيعات (الرقم الأهم) */}
        <Card className="relative overflow-hidden rounded-none border-0 bg-card shadow-none">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  صافي المبيعات قبل الضريبة
                </p>
                {isLoading ? (
                  <Skeleton className="h-7 w-20" />
                ) : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums truncate">
                    {fmt(kpi.netSales)}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-0.5">
                  <GrowthBadge
                    current={kpi.netSales}
                    previous={prevKpi.netSales}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    من {kpi.count} فاتورة
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* إجمالي الربح */}
        <Card className="relative overflow-hidden rounded-none border-0 bg-card shadow-none">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1 mb-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    إجمالي الربح
                  </p>
                </div>
                {isLoading ? (
                  <Skeleton className="h-7 w-20" />
                ) : (
                  <p
                    className={`text-2xl font-extrabold tracking-tight tabular-nums truncate ${kpi.grossProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
                  >
                    {fmt(kpi.grossProfit)}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  بعد خصم صافي تكلفة البضاعة
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* هامش الربح */}
        <Card className="relative overflow-hidden rounded-none border-0 bg-card shadow-none">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  هامش الربح
                </p>
                {isLoading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <p
                    className={`text-2xl font-extrabold tracking-tight tabular-nums ${kpi.grossMarginPercent !== null && kpi.grossMarginPercent >= 0 ? "text-emerald-600 dark:text-emerald-400" : kpi.grossMarginPercent !== null ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {kpi.grossMarginPercent === null
                      ? "—"
                      : `${kpi.grossMarginPercent.toFixed(1)}%`}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  إجمالي الربح ÷ صافي المبيعات
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* المرتجعات */}
        <Card className="relative overflow-hidden rounded-none border-0 bg-card shadow-none">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  المرتجعات قبل الضريبة
                </p>
                {isLoading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums text-destructive">
                    {fmt(kpi.returnsTotal)}
                  </p>
                )}
                {kpi.grossSales > 0 && kpi.returnsTotal > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {((kpi.returnsTotal / kpi.grossSales) * 100).toFixed(1)}% من
                    المبيعات
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* التحصيل النقدي */}
        <Card className="relative overflow-hidden rounded-none border-0 bg-card shadow-none">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  التحصيل النقدي/البنكي
                </p>
                {isLoading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums">
                    {kpi.cashCollectionRate === null
                      ? "—"
                      : `${kpi.cashCollectionRate.toFixed(1)}%`}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {fmt(kpi.cashCollected)} محصّل
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
          </div>
        </CardContent>
      </Card>

      {/* ── Actionable overdue alert only when needed ── */}
      {!isLoading && overdueInfo.count > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">{overdueInfo.count} فاتورة متأخرة</span>
          </div>
          <span className="font-mono font-semibold text-destructive">
            {fmt(overdueInfo.total)}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-2">
      {/* ── Invoice coverage — on demand ── */}
      <Collapsible
        open={showCoverage}
        onOpenChange={setShowCoverage}
        className="contents"
      >
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`${FLAT_ACTION_CLASS} ${showCoverage ? "!bg-primary/15 !text-primary" : ""}`}
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showCoverage ? "rotate-180" : ""}`}
            />
            تفاصيل تغطية الفواتير
            <span className="font-mono font-bold">
              {invoiceCoverage.totalCoverageRate === null
                ? "—"
                : `${invoiceCoverage.totalCoverageRate.toFixed(1)}%`}
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="order-last basis-full pt-2">
      <Card className="border shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Percent className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-semibold">تغطية فواتير الفترة</span>
              <Badge variant="outline" className="h-5 text-[10px]">
                شامل الضريبة
              </Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              إجمالي الفواتير {fmt(kpi.invoiceGrossTotal)}
            </span>
          </div>
          <div className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-x-reverse sm:divide-y-0">
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground">تحصيل نقدي/بنكي</p>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-lg font-bold tabular-nums">
                  {isLoading ? "—" : fmt(kpi.cashCollected)}
                </span>
                <Badge variant="secondary" className="font-mono">
                  {kpi.cashCollectionRate === null
                    ? "—"
                    : `${kpi.cashCollectionRate.toFixed(1)}%`}
                </Badge>
              </div>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground">تسويات أرصدة المرتجعات</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-violet-600 dark:text-violet-400">
                {isLoading ? "—" : fmt(kpi.returnSettled)}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground">إجمالي التغطية والمتبقي</p>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-lg font-bold tabular-nums">
                  {isLoading ? "—" : fmt(kpi.totalCovered)}
                </span>
                <span
                  className={`text-xs font-medium ${invoiceCoverage.outstanding > 0 ? "text-destructive" : "text-emerald-600"}`}
                >
                  المتبقي {isLoading ? "—" : fmt(invoiceCoverage.outstanding)}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* ── Collapsible: Extra KPIs ── */}
      <Collapsible
        open={showExtras}
        onOpenChange={setShowExtras}
        className="contents"
      >
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`${FLAT_ACTION_CLASS} ${showExtras ? "!bg-primary/15 !text-primary" : ""}`}
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${showExtras ? "rotate-180" : ""}`}
            />
            مؤشرات إضافية
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="order-last basis-full pt-2">
          <Card className="overflow-hidden border shadow-sm">
            <CardContent className="p-0">
              <div className="grid grid-cols-2 gap-px bg-border md:grid-flow-col md:grid-cols-none md:auto-cols-fr">
            {/* إجمالي المبيعات (قبل المرتجعات) */}
            <Card className="rounded-none border-0 bg-card shadow-none">
              <CardContent className="pt-4 pb-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  إجمالي المبيعات قبل الضريبة
                </p>
                {isLoading ? (
                  <Skeleton className="h-6 w-16" />
                ) : (
                  <p className="text-lg font-bold tabular-nums">
                    {fmt(kpi.grossSales)}
                  </p>
                )}
                <GrowthBadge
                  current={kpi.grossSales}
                  previous={prevKpi.grossSales}
                />
              </CardContent>
            </Card>

            {/* عدد الفواتير */}
            <Card className="rounded-none border-0 bg-card shadow-none">
              <CardContent className="pt-4 pb-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  عدد الفواتير
                </p>
                {isLoading ? (
                  <Skeleton className="h-6 w-12" />
                ) : (
                  <p className="text-lg font-bold tabular-nums">{kpi.count}</p>
                )}
                <GrowthBadge current={kpi.count} previous={prevKpi.count} />
              </CardContent>
            </Card>

            {/* متوسط الفاتورة */}
            <Card className="rounded-none border-0 bg-card shadow-none">
              <CardContent className="pt-4 pb-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  متوسط الفاتورة قبل الضريبة
                </p>
                {isLoading ? (
                  <Skeleton className="h-6 w-16" />
                ) : (
                  <p className="text-lg font-bold tabular-nums">
                    {fmt(kpi.count > 0 ? kpi.grossSales / kpi.count : 0)}
                  </p>
                )}
                <GrowthBadge
                  current={kpi.count > 0 ? kpi.grossSales / kpi.count : 0}
                  previous={
                    prevKpi.count > 0 ? prevKpi.grossSales / prevKpi.count : 0
                  }
                />
              </CardContent>
            </Card>

            {/* الخصم (يظهر فقط إذا > 0) */}
            {discountTaxInfo.discount > 0 && (
              <Card className="rounded-none border-0 bg-card shadow-none">
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    إجمالي الخصم
                  </p>
                  {isLoading ? (
                    <Skeleton className="h-6 w-16" />
                  ) : (
                    <p className="text-lg font-bold tabular-nums">
                      {fmt(discountTaxInfo.discount)}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* الضريبة (تظهر فقط إذا > 0) */}
            {discountTaxInfo.tax > 0 && (
              <Card className="rounded-none border-0 bg-card shadow-none">
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    إجمالي الضريبة
                  </p>
                  {isLoading ? (
                    <Skeleton className="h-6 w-16" />
                  ) : (
                    <p className="text-lg font-bold tabular-nums">
                      {fmt(discountTaxInfo.tax)}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {targetInfo && (
              <Card className="rounded-none border-0 bg-card shadow-none">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        تحقيق الهدف ({targetInfo.daysInRange} يوم
                        {targetInfo.isCappedAtAsOf ? " حتى اليوم" : ""})
                      </p>
                      <p className="text-lg font-bold tabular-nums">
                        {targetInfo.pct.toFixed(0)}%
                      </p>
                    </div>
                    <Target className="w-5 h-5 text-cyan-600" />
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5 mt-2">
                    <div
                      className={`h-1.5 rounded-full ${targetInfo.pct >= 100 ? "bg-emerald-500" : targetInfo.pct >= 80 ? "bg-primary" : "bg-amber-500"}`}
                      style={{ width: `${Math.min(targetInfo.pct, 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {fmt(kpi.netSales)} / {fmt(targetInfo.scaledTarget)}
                  </p>
                </CardContent>
              </Card>
            )}
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {chartMeta && chartData.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className={`${FLAT_ACTION_CLASS} ${showChart ? "!bg-primary/15 !text-primary" : ""}`}
          onClick={() => setShowChart((current) => !current)}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${showChart ? "rotate-180" : ""}`}
          />
          {showChart ? "إخفاء التحليل البصري" : "عرض التحليل البصري"}
        </Button>
      )}
      </div>

      {/* ── One chart matched to the active aggregate view ── */}
      {showChart && chartMeta && chartData.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b bg-muted/15 px-4 py-3">
            <p className="text-sm font-semibold">{chartMeta.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {chartMeta.description}
            </p>
          </div>
          <CardContent className="px-3 pb-3 pt-4 sm:px-4">
            <div className="h-[260px] w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                {groupBy === "time" ? (
                <ComposedChart
                  data={chartData}
                  margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
                >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      dataKey="name"
                      fontSize={11}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={24}
                      reversed
                    />
                    <YAxis
                      orientation="right"
                      width={72}
                      tickMargin={8}
                      fontSize={11}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: "8px",
                        border: "1px solid hsl(var(--border))",
                        fontSize: "12px",
                        direction: "rtl",
                        textAlign: "right",
                      }}
                      formatter={(value: number) => [fmt(Number(value)), "صافي المبيعات"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="صافي المبيعات"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2.5}
                      dot={chartData.length <= 15 ? { r: 3 } : false}
                    />
                  </ComposedChart>
                ) : (
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    barSize={20}
                    margin={{ top: 8, right: 8, bottom: 8, left: 16 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      horizontal
                    />
                    <XAxis
                      type="number"
                      fontSize={11}
                      axisLine={false}
                      tickLine={false}
                      reversed
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      orientation="right"
                      fontSize={11}
                      axisLine={false}
                      tickLine={false}
                      tickMargin={8}
                      width={160}
                      tickFormatter={(value: string) =>
                        value.length > 22
                          ? `${value.slice(0, 22)}…`
                          : value
                      }
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: "8px",
                        border: "1px solid hsl(var(--border))",
                        fontSize: "12px",
                        direction: "rtl",
                        textAlign: "right",
                      }}
                      formatter={(value: number) => [fmt(Number(value)), "صافي المبيعات"]}
                    />
                    <Bar
                      dataKey="صافي المبيعات"
                      fill="hsl(var(--primary))"
                      radius={[4, 0, 0, 4]}
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Data Table ── */}
      <Card>
        <CardContent className="pt-4">
          {groupBy === "invoice" ? (
            <DataTable
              columns={invoiceColumns}
              data={detailInvoices}
              isLoading={isLoading}
              pageSize={20}
              showPagination
              showSearch
              searchPlaceholder="بحث في الفواتير..."
              emptyMessage="لا توجد فواتير في هذه الفترة"
              sorting={invoiceSort}
              onSortingChange={(updater) =>
                setInvoiceSort(
                  typeof updater === "function" ? updater(invoiceSort) : updater,
                )
              }
              toolbarContent={
                <QuickSortToolbar
                  sorting={invoiceSort}
                  setSorting={setInvoiceSort}
                />
              }
              columnVisibility={invoiceColumnVisibility}
              onColumnVisibilityChange={setInvoiceColumnVisibility}
              columnToggleLabel="أعمدة إضافية"
              compactRows
            />
          ) : groupBy === "return" ? (
            <>
              <DataTable
                columns={returnColumns}
                data={detailReturns}
                isLoading={isLoading}
                pageSize={20}
                showPagination
                showSearch
                searchPlaceholder="بحث في مستندات المرتجعات..."
                emptyMessage="لا توجد مرتجعات بهذه الحالة في الفترة"
                columnVisibility={returnColumnVisibility}
                onColumnVisibilityChange={setReturnColumnVisibility}
                columnToggleLabel="أعمدة إضافية"
                compactRows
              />
              <p className="text-xs text-muted-foreground mt-2 text-center">
                كل مرتجع مستند مستقل ويؤثر في الفترة حسب تاريخ المرتجع، دون
                اشتراط ربطه بفاتورة مبيعات أصلية.
              </p>
            </>
          ) : groupBy === "customer" ? (
            <DataTable
              columns={customerColumns}
              data={customerData}
              isLoading={isLoading}
              pageSize={20}
              showPagination
              showSearch
              searchPlaceholder="بحث بالعميل..."
              emptyMessage="لا توجد بيانات"
              columnVisibility={customerColumnVisibility}
              onColumnVisibilityChange={setCustomerColumnVisibility}
              columnToggleLabel="أعمدة إضافية"
              compactRows
            />
          ) : groupBy === "product" ? (
            <>
              <DataTable
                columns={productColumns}
                data={productData}
                isLoading={isLoading}
                pageSize={20}
                showPagination
                showSearch
                searchPlaceholder="بحث بالمنتج..."
                emptyMessage="لا توجد بيانات"
                sorting={productSort}
                onSortingChange={(updater) =>
                  setProductSort(
                    typeof updater === "function"
                      ? updater(productSort)
                      : updater,
                  )
                }
                toolbarContent={
                  <QuickSortToolbar
                    sorting={productSort}
                    setSorting={setProductSort}
                  />
                }
                columnVisibility={productColumnVisibility}
                onColumnVisibilityChange={setProductColumnVisibility}
                columnToggleLabel="أعمدة إضافية"
                compactRows
              />

              <p className="text-xs text-muted-foreground mt-2 text-center">
                «صافي الكمية» يساوي المباع ناقص المرتجع. الصف المتعادل يبقى
                ظاهراً لإثبات حركة البيع والمرتجع داخل الفترة.
              </p>
            </>
          ) : groupBy === "category" ? (
            <DataTable
              columns={categoryColumns}
              data={categoryData}
              isLoading={isLoading}
              pageSize={20}
              showPagination
              showSearch
              searchPlaceholder="بحث بالتصنيف..."
              emptyMessage="لا توجد بيانات"
              columnVisibility={categoryColumnVisibility}
              onColumnVisibilityChange={setCategoryColumnVisibility}
              columnToggleLabel="أعمدة إضافية"
              compactRows
            />
          ) : (
            <DataTable
              columns={timeColumns}
              data={timeData}
              isLoading={isLoading}
              pageSize={31}
              showPagination
              showSearch={false}
              emptyMessage="لا توجد بيانات"
              columnVisibility={timeColumnVisibility}
              onColumnVisibilityChange={setTimeColumnVisibility}
              columnToggleLabel="أعمدة إضافية"
              compactRows
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
