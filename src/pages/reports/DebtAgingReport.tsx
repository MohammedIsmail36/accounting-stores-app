import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { REPORT_ENTRY_STATUSES } from "@/lib/report-period";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { DataTable } from "@/components/ui/data-table";
import { ExportMenu } from "@/components/ExportMenu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ColumnDef } from "@tanstack/react-table";
import { FileText, CreditCard, Wallet, Activity, Target } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useSettings } from "@/contexts/SettingsContext";
import { differenceInDays, format } from "date-fns";
import { AlertTriangle, Users, Truck, Clock, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── helpers ────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

type AgingSeverity = "current" | "warning" | "danger" | "critical";

interface AgingEntity {
  id: string;
  name: string;
  current: number; // 0-30
  days30: number; // 31-60
  days60: number; // 61-90
  days90: number; // 90+
  total: number;
  invoiceCount: number;
  oldestDays: number;
  severity: AgingSeverity;
}

interface AgingInvoice {
  invoiceNumber: string;
  entityName: string;
  invoiceDate: string;
  dueDate: string | null;
  total: number;
  paidAmount: number;
  remaining: number;
  agingDays: number;
  severity: AgingSeverity;
}

// ─── sub-components ───────────────────────────────────────────────────────────

const MetricHelp = ({ text }: { text: string }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3 w-3 text-muted-foreground/50 cursor-help shrink-0" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs text-right">
        {text}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

function getSeverity(days: number): AgingSeverity {
  if (days <= 30) return "current";
  if (days <= 60) return "warning";
  if (days <= 90) return "danger";
  return "critical";
}

const SEVERITY_BADGE: Record<AgingSeverity, { label: string; cls: string }> = {
  current: {
    label: "جاري",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
  },
  warning: {
    label: "متأخر",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
  },
  danger: {
    label: "خطر",
    cls: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400",
  },
  critical: {
    label: "حرج",
    cls: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
  },
};

function calcAgingData(
  invoices: any[],
  getName: (inv: any) => string,
  getId: (inv: any) => string,
): { entities: AgingEntity[]; invoiceDetails: AgingInvoice[] } {
  const today = new Date();
  const map: Record<string, AgingEntity> = {};
  const details: AgingInvoice[] = [];

  invoices.forEach((inv) => {
    const remaining = Number(inv.total) - Number(inv.paid_amount);
    if (remaining <= 0) return;

    const name = getName(inv);
    const entityId = getId(inv);
    const dueDate = inv.due_date || inv.invoice_date;
    const days = Math.max(differenceInDays(today, new Date(dueDate)), 0);
    const severity = getSeverity(days);

    if (!map[entityId]) {
      map[entityId] = {
        id: entityId,
        name,
        current: 0,
        days30: 0,
        days60: 0,
        days90: 0,
        total: 0,
        invoiceCount: 0,
        oldestDays: 0,
        severity: "current",
      };
    }

    if (days <= 30) map[entityId].current += remaining;
    else if (days <= 60) map[entityId].days30 += remaining;
    else if (days <= 90) map[entityId].days60 += remaining;
    else map[entityId].days90 += remaining;

    map[entityId].total += remaining;
    map[entityId].invoiceCount++;
    if (days > map[entityId].oldestDays) {
      map[entityId].oldestDays = days;
      map[entityId].severity = severity;
    }

    details.push({
      invoiceNumber: String(inv.invoice_number || inv.id?.slice(0, 8)),
      entityName: name,
      invoiceDate: inv.invoice_date,
      dueDate: inv.due_date || inv.invoice_date + " (بدون شروط)",
      total: Number(inv.total),
      paidAmount: Number(inv.paid_amount),
      remaining,
      agingDays: days,
      severity,
    });
  });

  return {
    entities: Object.values(map).sort((a, b) => b.total - a.total),
    invoiceDetails: details.sort((a, b) => b.agingDays - a.agingDays),
  };
}

// ─── main component ───────────────────────────────────────────────────────────

export default function DebtAgingReport() {
  const { settings } = useSettings();
  const [activeTab, setActiveTab] = useState<"customers" | "suppliers">(
    "customers",
  );

  // ── queries ────────────────────────────────────────────────────────────────

  const { data: salesInvoices = [], isLoading: loadingSales } = useQuery({
    queryKey: ["debt-aging-sales"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select(
          "id, invoice_number, invoice_date, due_date, total, paid_amount, status, customer_id, customer:customers(name)",
        )
        .in("status", [...REPORT_ENTRY_STATUSES]);
      if (error) throw error;
      return data;
    },
  });

  const { data: purchaseInvoices = [], isLoading: loadingPurchases } = useQuery(
    {
      queryKey: ["debt-aging-purchases"],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("purchase_invoices")
          .select(
            "id, invoice_number, invoice_date, due_date, total, paid_amount, status, supplier_id, supplier:suppliers(name)",
          )
          .in("status", [...REPORT_ENTRY_STATUSES]);
        if (error) throw error;
        return data;
      },
    },
  );

  const isLoading = loadingSales || loadingPurchases;

  // ── computed data ──────────────────────────────────────────────────────────

  const customerData = useMemo(
    () =>
      calcAgingData(
        salesInvoices,
        (inv) => inv.customer?.name || "بدون عميل",
        (inv) => inv.customer_id || inv.id,
      ),
    [salesInvoices],
  );

  const supplierData = useMemo(
    () =>
      calcAgingData(
        purchaseInvoices,
        (inv) => inv.supplier?.name || "بدون مورد",
        (inv) => inv.supplier_id || inv.id,
      ),
    [purchaseInvoices],
  );

  const activeData = activeTab === "customers" ? customerData : supplierData;

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const totalCustomerDebt = customerData.entities.reduce(
      (s, e) => s + e.total,
      0,
    );
    const totalSupplierDebt = supplierData.entities.reduce(
      (s, e) => s + e.total,
      0,
    );

    const overdueCustomer90 = customerData.entities.reduce(
      (s, e) => s + e.days90,
      0,
    );
    const overdueSupplier90 = supplierData.entities.reduce(
      (s, e) => s + e.days90,
      0,
    );

    const criticalCustomerCount = customerData.entities.filter(
      (e) => e.severity === "critical",
    ).length;
    const criticalSupplierCount = supplierData.entities.filter(
      (e) => e.severity === "critical",
    ).length;

    const calcWeightedAvg = (entities: AgingEntity[]) => {
      const totalDebt = entities.reduce((s, e) => s + e.total, 0);
      if (totalDebt === 0) return 0;
      const weighted = entities.reduce((s, e) => {
        const avgBucket =
          e.current * 15 + e.days30 * 45 + e.days60 * 75 + e.days90 * 120;
        return s + avgBucket;
      }, 0);
      return Math.round(weighted / totalDebt);
    };

    const top5Share = (entities: AgingEntity[], total: number) => {
      if (total <= 0) return 0;
      const top5 = entities.slice(0, 5).reduce((s, e) => s + e.total, 0);
      return (top5 / total) * 100;
    };

    return {
      totalCustomerDebt,
      totalSupplierDebt,
      overdueCustomer90,
      overdueSupplier90,
      criticalCustomerCount,
      criticalSupplierCount,
      avgCustomerDays: calcWeightedAvg(customerData.entities),
      avgSupplierDays: calcWeightedAvg(supplierData.entities),
      customerEntityCount: customerData.entities.length,
      supplierEntityCount: supplierData.entities.length,
      netLiquidity: totalCustomerDebt - totalSupplierDebt,
      customerConcentration: top5Share(
        customerData.entities,
        totalCustomerDebt,
      ),
      supplierConcentration: top5Share(
        supplierData.entities,
        totalSupplierDebt,
      ),
    };
  }, [customerData, supplierData]);

  // ── chart data ────────────────────────────────────────────────────────────

  const chartData = useMemo(() => {
    const entities = activeData.entities.slice(0, 10);
    return entities.map((e) => ({
      name: e.name.length > 15 ? e.name.slice(0, 15) + "…" : e.name,
      "0-30 يوم": e.current,
      "31-60 يوم": e.days30,
      "61-90 يوم": e.days60,
      "90+ يوم": e.days90,
    }));
  }, [activeData]);

  // ── entity table columns ─────────────────────────────────────────────────

  const entityColumns = useMemo<ColumnDef<AgingEntity, any>[]>(
    () => [
      {
        accessorKey: "name",
        header: activeTab === "customers" ? "العميل" : "المورد",
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-sm">{row.original.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {row.original.invoiceCount} فاتورة
            </p>
          </div>
        ),
      },
      {
        accessorKey: "current",
        header: () => (
          <div className="flex items-center gap-1 justify-center">
            <span>0-30 يوم</span>
            <MetricHelp text="ديون مستحقة منذ أقل من 30 يوم — وضع طبيعي" />
          </div>
        ),
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <span
              className={cn(
                "tabular-nums text-sm",
                v > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground",
              )}
            >
              {v > 0 ? fmt(v) : "—"}
            </span>
          );
        },
      },
      {
        accessorKey: "days30",
        header: () => (
          <div className="flex items-center gap-1 justify-center">
            <span>31-60 يوم</span>
          </div>
        ),
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <span
              className={cn(
                "tabular-nums text-sm",
                v > 0
                  ? "text-amber-600 dark:text-amber-400 font-medium"
                  : "text-muted-foreground",
              )}
            >
              {v > 0 ? fmt(v) : "—"}
            </span>
          );
        },
      },
      {
        accessorKey: "days60",
        header: "61-90 يوم",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <span
              className={cn(
                "tabular-nums text-sm",
                v > 0
                  ? "text-orange-600 dark:text-orange-400 font-semibold"
                  : "text-muted-foreground",
              )}
            >
              {v > 0 ? fmt(v) : "—"}
            </span>
          );
        },
      },
      {
        accessorKey: "days90",
        header: () => (
          <div className="flex items-center gap-1 justify-center">
            <span className="text-destructive">90+ يوم</span>
            <MetricHelp text="ديون متأخرة جداً تحتاج إجراء فوري للتحصيل" />
          </div>
        ),
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <span
              className={cn(
                "tabular-nums text-sm",
                v > 0 ? "text-destructive font-bold" : "text-muted-foreground",
              )}
            >
              {v > 0 ? fmt(v) : "—"}
            </span>
          );
        },
      },
      {
        accessorKey: "total",
        header: "الإجمالي",
        cell: ({ getValue }) => (
          <span className="tabular-nums font-bold text-sm">
            {fmt(getValue() as number)}
          </span>
        ),
      },
      {
        accessorKey: "oldestDays",
        header: "أقدم دين",
        cell: ({ row }) => {
          const days = row.original.oldestDays;
          return (
            <span
              className={cn(
                "tabular-nums text-sm",
                days > 90
                  ? "text-destructive font-semibold"
                  : days > 60
                    ? "text-orange-600"
                    : "text-muted-foreground",
              )}
            >
              {days} يوم
            </span>
          );
        },
      },
      {
        accessorKey: "severity",
        header: "الحالة",
        cell: ({ getValue }) => {
          const s = getValue() as AgingSeverity;
          const { label, cls } = SEVERITY_BADGE[s];
          return (
            <Badge variant="secondary" className={cn("text-xs", cls)}>
              {label}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: "إجراء",
        cell: ({ row }) => {
          const isCustomer = activeTab === "customers";
          const statementPath = isCustomer
            ? `/customer-statement/${row.original.id}`
            : `/supplier-statement/${row.original.id}`;
          const paymentPath = isCustomer
            ? `/customer-payments?customer_id=${row.original.id}`
            : `/supplier-payments?supplier_id=${row.original.id}`;
          return (
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                  >
                    <Link to={statementPath}>
                      <FileText className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  كشف حساب
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                  >
                    <Link to={paymentPath}>
                      <CreditCard className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {isCustomer ? "تحصيل دفعة" : "سداد دفعة"}
                </TooltipContent>
              </Tooltip>
            </div>
          );
        },
      },
    ],
    [activeTab],
  );

  // ── row class for critical ────────────────────────────────────────────────

  // (row styling handled via column badges)

  // ── export config ─────────────────────────────────────────────────────────

  const exportConfig = useMemo(() => {
    const label = activeTab === "customers" ? "العملاء" : "الموردين";
    const data = activeData.entities;
    return {
      filenamePrefix: `أعمار-ديون-${label}`,
      sheetName: "أعمار الديون",
      pdfTitle: `تقرير أعمار الديون — ${label}`,
      headers: [
        activeTab === "customers" ? "العميل" : "المورد",
        "0-30 يوم",
        "31-60 يوم",
        "61-90 يوم",
        "90+ يوم",
        "الإجمالي",
        "عدد الفواتير",
        "أقدم دين (يوم)",
        "الحالة",
      ],
      rows: data.map((d) => [
        d.name,
        d.current > 0 ? d.current : "—",
        d.days30 > 0 ? d.days30 : "—",
        d.days60 > 0 ? d.days60 : "—",
        d.days90 > 0 ? d.days90 : "—",
        d.total,
        d.invoiceCount,
        d.oldestDays,
        SEVERITY_BADGE[d.severity].label,
      ]),
      summaryCards: [
        { label: "إجمالي ديون العملاء", value: fmt(kpis.totalCustomerDebt) },
        { label: "إجمالي ديون الموردين", value: fmt(kpis.totalSupplierDebt) },
        {
          label: `ديون 90+ يوم (${label})`,
          value: fmt(
            activeTab === "customers"
              ? kpis.overdueCustomer90
              : kpis.overdueSupplier90,
          ),
        },
      ],
      settings,
      pdfOrientation: "landscape" as const,
    };
  }, [activeTab, activeData, kpis, settings]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="pt-5 pb-4">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-5">
        {/* ── KPI Cards ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* KPI 1 — Total Customer Debt */}
          <Card className="border shadow-sm">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground mb-1">
                    ديون العملاء
                  </p>
                  <p
                    className={cn(
                      "text-lg font-bold tabular-nums",
                      kpis.totalCustomerDebt > 0
                        ? "text-destructive"
                        : "text-foreground",
                    )}
                  >
                    {fmt(kpis.totalCustomerDebt)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {kpis.customerEntityCount} عميل
                  </p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-500/10 flex items-center justify-center shrink-0">
                  <Users className="h-4 w-4 text-red-600 dark:text-red-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* KPI 2 — Total Supplier Debt */}
          <Card className="border shadow-sm">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground mb-1">
                    ديون الموردين
                  </p>
                  <p
                    className={cn(
                      "text-lg font-bold tabular-nums",
                      kpis.totalSupplierDebt > 0
                        ? "text-primary"
                        : "text-foreground",
                    )}
                  >
                    {fmt(kpis.totalSupplierDebt)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {kpis.supplierEntityCount} مورد
                  </p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Truck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* KPI 3 — Overdue 90+ */}
          <Card className="border shadow-sm">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground mb-1">
                    ديون متأخرة 90+ يوم
                  </p>
                  <p
                    className={cn(
                      "text-lg font-bold tabular-nums",
                      kpis.overdueCustomer90 + kpis.overdueSupplier90 > 0
                        ? "text-destructive"
                        : "text-foreground",
                    )}
                  >
                    {fmt(kpis.overdueCustomer90 + kpis.overdueSupplier90)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {kpis.criticalCustomerCount + kpis.criticalSupplierCount}{" "}
                    جهة حرجة
                  </p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-500/10 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* KPI 4 — Average Aging */}
          <Card className="border shadow-sm">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground mb-1">
                    متوسط عمر الدين
                  </p>
                  <p className="text-lg font-bold tabular-nums text-foreground">
                    {activeTab === "customers"
                      ? kpis.avgCustomerDays
                      : kpis.avgSupplierDays}
                    <span className="text-xs font-normal text-muted-foreground mr-1">
                      يوم
                    </span>
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {activeTab === "customers" ? "عملاء" : "موردين"} (مرجّح
                    بالقيمة)
                  </p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-500/10 flex items-center justify-center shrink-0">
                  <Clock className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Decision Strip: Net Liquidity + Concentration + Critical Alerts ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Net liquidity */}
          <Card className="border shadow-sm">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-2">
                <Wallet className="h-4 w-4 text-primary" />
                <h4 className="text-sm font-semibold">صافي تدفق الديون</h4>
                <MetricHelp text="إجمالي ديون العملاء (المتوقع تحصيلها) ناقص ديون الموردين (الواجب سدادها). موجب = فائض متوقع، سالب = عجز." />
              </div>
              <p
                className={cn(
                  "text-xl font-bold tabular-nums",
                  kpis.netLiquidity >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive",
                )}
              >
                {kpis.netLiquidity >= 0 ? "+" : "−"}
                {fmt(Math.abs(kpis.netLiquidity))}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {kpis.netLiquidity >= 0
                  ? "فائض متوقع بعد التحصيل والسداد"
                  : "تحتاج توفير سيولة إضافية للسداد"}
              </p>
            </CardContent>
          </Card>

          {/* Risk concentration */}
          <Card className="border shadow-sm">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-2">
                <Target className="h-4 w-4 text-primary" />
                <h4 className="text-sm font-semibold">تركيز المخاطر</h4>
                <MetricHelp text="حصة أعلى 5 جهات من إجمالي الديون. كلما زادت النسبة، زاد اعتمادك على عدد قليل من الجهات." />
              </div>
              {(() => {
                const conc =
                  activeTab === "customers"
                    ? kpis.customerConcentration
                    : kpis.supplierConcentration;
                const tone =
                  conc > 70
                    ? "text-destructive"
                    : conc > 50
                      ? "text-orange-600"
                      : "text-emerald-600";
                return (
                  <>
                    <p
                      className={cn(
                        "text-xl font-bold tabular-nums",
                        tone,
                      )}
                    >
                      {conc.toFixed(1)}%
                    </p>
                    <Progress
                      value={Math.min(100, conc)}
                      className="h-1.5 mt-2"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      أعلى 5 {activeTab === "customers" ? "عملاء" : "موردين"}{" "}
                      من الإجمالي
                    </p>
                  </>
                );
              })()}
            </CardContent>
          </Card>

          {/* Top critical alerts */}
          <Card className="border shadow-sm">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="h-4 w-4 text-destructive" />
                <h4 className="text-sm font-semibold">أعلى 3 جهات حرجة</h4>
              </div>
              {(() => {
                const critical = activeData.entities
                  .filter((e) => e.severity === "critical")
                  .slice(0, 3);
                if (critical.length === 0)
                  return (
                    <p className="text-xs text-muted-foreground py-2">
                      ✓ لا توجد جهات حرجة (90+ يوم)
                    </p>
                  );
                return (
                  <div className="space-y-1.5">
                    {critical.map((e) => {
                      const path =
                        activeTab === "customers"
                          ? `/customer-statement/${e.id}`
                          : `/supplier-statement/${e.id}`;
                      return (
                        <Link
                          key={e.id}
                          to={path}
                          className="flex items-center justify-between gap-2 text-xs hover:bg-muted/50 px-2 py-1 -mx-1 rounded transition-colors"
                        >
                          <span className="truncate font-medium">{e.name}</span>
                          <span className="font-mono tabular-nums text-destructive font-semibold shrink-0">
                            {fmt(e.days90)}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────── */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as any)}
          dir="rtl"
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <TabsList>
              <TabsTrigger value="customers" className="gap-1.5">
                <Users className="h-3.5 w-3.5" />
                ديون العملاء
                {customerData.entities.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 h-4 mr-1"
                  >
                    {customerData.entities.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="suppliers" className="gap-1.5">
                <Truck className="h-3.5 w-3.5" />
                ديون الموردين
                {supplierData.entities.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 h-4 mr-1"
                  >
                    {supplierData.entities.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <ExportMenu config={exportConfig} />
          </div>

          {/* ── Chart ─────────────────────────────────────────────────── */}
          {chartData.length > 0 && (
            <Card className="border shadow-sm mt-4">
              <CardContent className="pt-4 pb-2">
                <p className="text-sm font-semibold mb-3">
                  توزيع الديون — أعلى {Math.min(activeData.entities.length, 10)}{" "}
                  {activeTab === "customers" ? "عملاء" : "موردين"}
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      layout="vertical"
                      margin={{ top: 0, right: 10, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis
                        type="number"
                        tickFormatter={(v) => fmt(v)}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={110}
                        tick={{ fontSize: 11, textAnchor: "end" }}
                      />
                      <RTooltip
                        formatter={(value: number) => fmt(value)}
                        contentStyle={{
                          direction: "rtl",
                          fontSize: 12,
                          borderRadius: 8,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar
                        dataKey="0-30 يوم"
                        stackId="a"
                        fill="hsl(152,60%,42%)"
                        radius={[0, 0, 0, 0]}
                      />
                      <Bar
                        dataKey="31-60 يوم"
                        stackId="a"
                        fill="hsl(38,92%,50%)"
                      />
                      <Bar
                        dataKey="61-90 يوم"
                        stackId="a"
                        fill="hsl(25,95%,53%)"
                      />
                      <Bar
                        dataKey="90+ يوم"
                        stackId="a"
                        fill="hsl(0,72%,51%)"
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Tables ────────────────────────────────────────────────── */}
          <TabsContent value="customers" className="mt-4">
            <DataTable
              columns={entityColumns}
              data={customerData.entities}
              showSearch
              searchPlaceholder="بحث بالاسم..."
              emptyMessage="لا توجد ديون مستحقة للعملاء"
            />
          </TabsContent>

          <TabsContent value="suppliers" className="mt-4">
            <DataTable
              columns={entityColumns}
              data={supplierData.entities}
              showSearch
              searchPlaceholder="بحث بالاسم..."
              emptyMessage="لا توجد ديون مستحقة للموردين"
            />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
