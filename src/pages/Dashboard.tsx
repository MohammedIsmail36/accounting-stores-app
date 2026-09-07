import { useEffect, useState } from "react";
import { EmptyState as SharedEmptyState } from "@/components/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { formatProductDisplay } from "@/lib/product-utils";
import { formatDisplayNumber } from "@/lib/posted-number-utils";
import { computeDerivedTotals, RECENT_SALES_DAYS, type AccountBalance } from "@/lib/dashboard-metrics";
import { useDashboardKpis } from "@/hooks/use-dashboard-kpis";
import { useDashboardInsights } from "@/hooks/use-dashboard-insights";
import { useDashboardTables } from "@/hooks/use-dashboard-tables";
import { useSettings } from "@/contexts/SettingsContext";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageHeader } from "@/components/PageHeader";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp,
  TrendingDown,
  Package,
  DollarSign,
  ShoppingCart,
  AlertTriangle,
  Calculator,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  ReceiptText,
  Wallet,
  Users,
  Landmark,
  Banknote,
  BarChart3,
  Award,
  Target,
  PackageX,
  Clock,
  ChevronRight,
  LayoutDashboard,
  Coins,
  Scale,
  PiggyBank,
  TrendingUpIcon,
  PieChart,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";
import { toDateString, toWesternDigits } from "@/lib/utils";

// Types, constants and pure calculations live in @/lib/dashboard-metrics


// ─── Shared helpers ────────────────────────────────────────────────────────────
function EmptyState({ message = "لا توجد بيانات" }: { message?: string }) {
  return <SharedEmptyState compact icon={Package} title={message} />;
}
function KpiSkeleton() {
  return (
    <Card className="border-border/60 shadow-sm overflow-hidden">
      <div className="h-0.5 bg-muted" />
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-36" />
          </div>
          <Skeleton className="w-11 h-11 rounded-xl" />
        </div>
      </CardContent>
    </Card>
  );
}
function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="p-4 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

// ─── Last 7 Days ───────────────────────────────────────────────────────────────
function Last7DaysSalesTable({ formatCurrency }: { formatCurrency: (n: number) => string }) {
  const [data, setData] = useState<{ date: string; count: number; total: number; paid: number }[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      const { data: invoices } = await supabase
        .from("sales_invoices")
        .select("invoice_date, total, paid_amount")
        .eq("status", "posted")
        .gte("invoice_date", toDateString(from))
        .lte("invoice_date", toDateString(now));
      const map: Record<string, { count: number; total: number; paid: number }> = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        map[toDateString(d)] = { count: 0, total: 0, paid: 0 };
      }
      (invoices || []).forEach((inv) => {
        const k = inv.invoice_date;
        if (map[k]) {
          map[k].count++;
          map[k].total += Number(inv.total);
          map[k].paid += Number(inv.paid_amount);
        }
      });
      setData(Object.entries(map).map(([date, v]) => ({ date, ...v })));
      setLoading(false);
    })();
  }, []);
  if (loading) return <TableSkeleton rows={7} />;
  const totals = data.reduce(
    (s, d) => ({
      count: s.count + d.count,
      total: s.total + d.total,
      paid: s.paid + d.paid,
    }),
    { count: 0, total: 0, paid: 0 },
  );
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableHead className="text-xs">التاريخ</TableHead>
          <TableHead className="text-xs text-center">الفواتير</TableHead>
          <TableHead className="text-xs text-end">الإجمالي</TableHead>
          <TableHead className="text-xs text-end">المدفوع</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((d) => (
          <TableRow
            key={d.date}
            className="hover:bg-muted/30 transition-colors border-b border-border/40 last:border-0"
          >
            <TableCell className="text-sm font-mono text-muted-foreground">{d.date}</TableCell>
            <TableCell className="text-sm text-center tabular-nums">
              {d.count || <span className="text-muted-foreground/40">—</span>}
            </TableCell>
            <TableCell className="text-sm text-end tabular-nums">{formatCurrency(d.total)}</TableCell>
            <TableCell className="text-sm text-end tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatCurrency(d.paid)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <tfoot>
        <TableRow className="bg-muted/50 border-t-2 border-border font-bold">
          <TableCell className="text-sm">الإجمالي</TableCell>
          <TableCell className="text-sm text-center tabular-nums">{totals.count}</TableCell>
          <TableCell className="text-sm text-end tabular-nums">{formatCurrency(totals.total)}</TableCell>
          <TableCell className="text-sm text-end tabular-nums text-emerald-600 dark:text-emerald-400">
            {formatCurrency(totals.paid)}
          </TableCell>
        </TableRow>
      </tfoot>
    </Table>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate();
  const { formatCurrency, settings } = useSettings();

  const {
    loadingKPIs,
    loadingSecondary,
    totalSales,
    totalPurchases,
    totalExpenses,
    operatingExpenses,
    systemAdjustments,
    totalSalesReturns,
    totalPurchaseReturns,
    totalCOGS,
    salesChange,
    purchasesChange,
    expensesChange,
    currentMonthSales,
    receivables,
    payables,
    inventoryValue,
    lowStockCount,
  } = useDashboardKpis();

  const { loadingCharts, loadingRight, monthlyData, monthlyExpenses, liquidity, expensesByType, recentActivities } =
    useDashboardInsights(settings);

  const {
    loadingTables,
    unpaidInvoices,
    topProducts,
    lowStockItems,
    accountBalances,
    topCategories,
    stagnantItems,
    agingBuckets,
    topCustomers,
  } = useDashboardTables();

  // ── Derived ─────────────────────────────────────────────────────────────────
  const { netSales, netPurchases, grossProfit, netProfit, profitMargin } = computeDerivedTotals({
    totalSales,
    totalSalesReturns,
    totalPurchases,
    totalPurchaseReturns,
    totalCOGS,
    totalExpenses,
  });


  // ── UI helpers ───────────────────────────────────────────────────────────────
  const renderChange = (change: number | null) => {
    if (change === null) return <span className="text-xs text-muted-foreground/60">لا توجد بيانات سابقة</span>;
    const pos = change >= 0;
    return (
      <span
        className={`text-xs font-semibold flex items-center gap-0.5 ${pos ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
      >
        {pos ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        {Math.abs(change).toFixed(1)}%
        <span className="text-muted-foreground/70 font-normal mr-1">مقارنة بالشهر السابق</span>
      </span>
    );
  };

  const SectionLink = ({ label, to }: { label: string; to: string }) => (
    <button
      onClick={() => navigate(to)}
      className="text-xs text-primary/80 hover:text-primary font-medium flex items-center gap-0.5 transition-colors"
    >
      {label}
      <ChevronRight className="w-3.5 h-3.5" />
    </button>
  );

  const ZoneHeader = ({
    icon: Icon,
    title,
    subtitle,
    to,
    linkLabel,
  }: {
    icon: React.ElementType;
    title: string;
    subtitle?: string;
    to?: string;
    linkLabel?: string;
  }) => (
    <div className="flex items-center justify-between mb-5 pb-3 border-b border-border/50">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-bold leading-tight">{title}</h2>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {to && linkLabel && <SectionLink label={linkLabel} to={to} />}
    </div>
  );

  // ── Shorthand classes ─────────────────────────────────────────────────────
  const th = "bg-muted/40 hover:bg-muted/40";
  const tr = "hover:bg-muted/30 transition-colors border-b border-border/40 last:border-0";

  const todayLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());

  const kpiCards = [
    {
      label: "إجمالي المبيعات",
      value: totalSales,
      change: salesChange,
      icon: DollarSign,
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
      accent: "bg-primary",
    },
    {
      label: "إجمالي المشتريات",
      value: totalPurchases,
      change: purchasesChange,
      icon: ShoppingCart,
      iconBg: "bg-amber-500/10",
      iconColor: "text-amber-500",
      accent: "bg-amber-500",
    },
    {
      label: netProfit >= 0 ? "صافي الربح" : "صافي الخسارة",
      value: Math.abs(netProfit),
      extraLabel: `${netProfit >= 0 ? "هامش الربح" : "هامش الخسارة"} ${profitMargin}%`,
      icon: netProfit >= 0 ? TrendingUp : TrendingDown,
      iconBg: netProfit >= 0 ? "bg-emerald-500/10" : "bg-destructive/10",
      iconColor: netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
      valueColor: netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
      accent: netProfit >= 0 ? "bg-emerald-500" : "bg-destructive",
    },
    {
      label: "إجمالي المصروفات",
      value: totalExpenses + totalCOGS,
      change: expensesChange,
      icon: ReceiptText,
      iconBg: "bg-destructive/10",
      iconColor: "text-destructive",
      accent: "bg-destructive",
    },
  ];

  const secondaryCards = [
    {
      label: "المستحقات",
      icon: Users,
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
      value: receivables,
    },
    {
      label: "المطلوبات",
      icon: Landmark,
      iconBg: "bg-amber-500/10",
      iconColor: "text-amber-500",
      value: payables,
    },
    {
      label: "قيمة المخزون",
      icon: Boxes,
      iconBg: "bg-emerald-500/10",
      iconColor: "text-emerald-600 dark:text-emerald-400",
      value: inventoryValue,
    },
    {
      label: "نقص المخزون",
      icon: AlertTriangle,
      iconBg: lowStockCount > 0 ? "bg-destructive/10" : "bg-emerald-500/10",
      iconColor: lowStockCount > 0 ? "text-destructive" : "text-emerald-600",
      value: null,
    },
  ];

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="max-w-[1400px] mx-auto pb-12">
      <PageHeader
        icon={LayoutDashboard}
        title="لوحة التحكم"
        description={todayLabel}
        badge={
          !loadingKPIs ? (
            <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border ${
                  netProfit >= 0
                    ? "bg-emerald-500/8 border-emerald-400/30 text-emerald-700 dark:text-emerald-400"
                    : "bg-destructive/8 border-destructive/30 text-destructive"
                }`}
              >
                {netProfit >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {netProfit >= 0 ? "الأعمال في نمو" : "راجع المصروفات"}
              </span>
              {lowStockCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border bg-destructive/8 border-destructive/30 text-destructive">
                  <AlertTriangle className="w-3 h-3" />
                  {lowStockCount} صنف بنقص
                </span>
              )}
            </div>
          ) : null
        }
      />

      {/* ─── Zone divider helper (inline) ────────────────────────────────── */}
      {/* We use a local pattern: label over a rule */}

      {/* ═══════════════════════════════════════════════════════════════════════
          ZONE 1 — الملخص المالي
         ═══════════════════════════════════════════════════════════════════════ */}
      <ErrorBoundary section>
        <div className="mb-10 space-y-4">
          {/* Zone label */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center gap-2">
              <div className="w-1 h-5 rounded-full bg-primary" />
              <h2 className="text-sm font-bold text-foreground">الملخص المالي</h2>
            </div>
            <div className="flex-1 h-px bg-border/50" />
            <p className="text-[11px] text-muted-foreground shrink-0">السنة الحالية</p>
          </div>

          {/* Primary KPIs — 4 cols */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {loadingKPIs
              ? [1, 2, 3, 4].map((i) => <KpiSkeleton key={i} />)
              : kpiCards.map((card, idx) => {
                  const Icon = card.icon;
                  return (
                    <Card
                      key={idx}
                      className="border-border/60 shadow-sm hover:shadow-md transition-all overflow-hidden relative group"
                    >
                      <div className={`absolute top-0 inset-x-0 h-0.5 ${card.accent}`} />
                      <CardContent className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1.5 min-w-0">
                            <p className="text-xs font-medium text-muted-foreground">{card.label}</p>
                            <p
                              className={`text-2xl font-extrabold tracking-tight tabular-nums truncate ${(card as any).valueColor || ""}`}
                            >
                              {formatCurrency(card.value)}
                            </p>
                            {"change" in card ? (
                              renderChange((card as any).change)
                            ) : (
                              <span className="text-xs text-muted-foreground/70">{(card as any).extraLabel}</span>
                            )}
                          </div>
                          <div
                            className={`w-11 h-11 rounded-xl ${card.iconBg} flex items-center justify-center shrink-0 shadow-inner`}
                          >
                            <Icon className={`w-5 h-5 ${card.iconColor}`} />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
          </div>

          {/* Secondary KPIs — 4 cols */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {loadingSecondary
              ? [1, 2, 3, 4].map((i) => (
                  <Card key={i} className="border-border/60 shadow-sm">
                    <CardContent className="p-4 flex items-center gap-3">
                      <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
                      <div className="space-y-1.5 flex-1">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-5 w-3/4" />
                      </div>
                    </CardContent>
                  </Card>
                ))
              : secondaryCards.map((card, idx) => {
                  const Icon = card.icon;
                  return (
                    <Card key={idx} className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
                      <CardContent className="p-4 flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-xl ${card.iconBg} flex items-center justify-center shrink-0 shadow-inner`}
                        >
                          <Icon className={`w-5 h-5 ${card.iconColor}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-muted-foreground truncate">{card.label}</p>
                          {card.value !== null ? (
                            <p className="text-base font-bold tabular-nums truncate">{formatCurrency(card.value)}</p>
                          ) : (
                            <p className="text-base font-bold">
                              {lowStockCount} <span className="text-xs font-normal text-muted-foreground">صنف</span>
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
          </div>
        </div>
      </ErrorBoundary>

      {/* ═══════════════════════════════════════════════════════════════════════
          ZONE 2 — الاتجاهات والتحليل
          Layout: charts 2/3 · sidebar 1/3
         ═══════════════════════════════════════════════════════════════════════ */}
      <ErrorBoundary section>
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center gap-2">
              <div className="w-1 h-5 rounded-full bg-blue-500" />
              <h2 className="text-sm font-bold text-foreground">الاتجاهات والتحليل</h2>
            </div>
            <div className="flex-1 h-px bg-border/50" />
            <p className="text-[11px] text-muted-foreground shrink-0">أداء الأشهر الماضية</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Charts — 2 columns */}
            <div className="lg:col-span-2 space-y-4">
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold">المبيعات مقابل المشتريات</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">آخر 6 أشهر</p>
                  </div>
                  <Badge variant="outline" className="text-xs border-border/60 text-muted-foreground shrink-0">
                    <BarChart3 className="w-3 h-3 ml-1" />
                    {new Date().getFullYear()}
                  </Badge>
                </CardHeader>
                <CardContent className="pt-6" style={{ minHeight: "330px" }}>
                  {loadingCharts ? (
                    <Skeleton className="h-[240px] w-full" />
                  ) : (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={monthlyData.slice(-6)} barSize={28}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                        <XAxis
                          dataKey="name"
                          fontSize={11}
                          axisLine={false}
                          tickLine={false}
                          reversed
                          tick={{ textAnchor: "middle", direction: "ltr" } as any}
                        />
                        <YAxis
                          fontSize={10}
                          axisLine={false}
                          tickLine={false}
                          orientation="right"
                          width={48}
                          tick={{ textAnchor: "start", direction: "ltr" } as any}
                          tickFormatter={(v: number) =>
                            new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v)
                          }
                        />
                        <Tooltip
                          contentStyle={{
                            borderRadius: "8px",
                            border: "1px solid hsl(var(--border))",
                            fontSize: "12px",
                          }}
                        />
                        <Bar dataKey="مبيعات" fill="hsl(var(--primary))" radius={[5, 5, 0, 0]} />
                        <Bar dataKey="مشتريات" fill="hsl(var(--primary) / 0.22)" radius={[5, 5, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/60 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">المصروفات الشهرية</CardTitle>
                </CardHeader>
                <CardContent className="pt-6" style={{ minHeight: "410px" }}>
                  {loadingCharts ? (
                    <Skeleton className="h-[180px] w-full" />
                  ) : (
                    <ResponsiveContainer width="100%" height={274}>
                      <LineChart data={monthlyExpenses.slice(-6)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                        <XAxis
                          dataKey="name"
                          fontSize={11}
                          axisLine={false}
                          tickLine={false}
                          reversed
                          tick={{ textAnchor: "middle", direction: "ltr" } as any}
                        />
                        <YAxis
                          fontSize={10}
                          axisLine={false}
                          tickLine={false}
                          orientation="right"
                          width={48}
                          tick={{ textAnchor: "start", direction: "ltr" } as any}
                          tickFormatter={(v: number) =>
                            new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v)
                          }
                        />
                        <Tooltip
                          contentStyle={{
                            borderRadius: "8px",
                            border: "1px solid hsl(var(--border))",
                            fontSize: "12px",
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="مصروفات"
                          stroke="hsl(var(--destructive))"
                          strokeWidth={2.5}
                          dot={{ r: 4, fill: "hsl(var(--destructive))" }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar — 1 column */}
            <div className="space-y-4">
              {/* Liquidity */}
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-primary" /> السيولة النقدية
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {loadingRight ? (
                    <Skeleton className="h-24 w-full" />
                  ) : (
                    <>
                      <div className="text-center py-2 bg-muted/30 rounded-xl">
                        <p className="text-[11px] text-muted-foreground">الإجمالي</p>
                        <p className="text-xl font-extrabold text-primary tabular-nums mt-0.5">
                          {formatCurrency(liquidity.total)}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-muted/40 rounded-xl p-3 text-center">
                          <p className="text-[11px] text-muted-foreground">البنوك</p>
                          <p className="text-sm font-bold tabular-nums mt-0.5">{formatCurrency(liquidity.bank)}</p>
                        </div>
                        <div className="bg-muted/40 rounded-xl p-3 text-center">
                          <p className="text-[11px] text-muted-foreground">الصندوق</p>
                          <p className="text-sm font-bold tabular-nums mt-0.5">{formatCurrency(liquidity.cash)}</p>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Expense Distribution — compact */}
              {!loadingKPIs &&
                (() => {
                  const totalAll = totalCOGS + operatingExpenses + systemAdjustments;
                  if (totalAll <= 0) return null;
                  const pct = (v: number) => Math.round((v / totalAll) * 100);
                  const cogsPct = pct(totalCOGS);
                  const opPct = pct(operatingExpenses);
                  const sysPct = pct(systemAdjustments);
                  const rows = [
                    {
                      label: "تكلفة البضاعة المباعة",
                      value: totalCOGS,
                      pct: cogsPct,
                      color: "bg-blue-500",
                      text: "text-blue-600 dark:text-blue-400",
                    },
                    {
                      label: "مصروفات تشغيلية",
                      value: operatingExpenses,
                      pct: opPct,
                      color: "bg-amber-500",
                      text: "text-amber-600 dark:text-amber-400",
                    },
                    {
                      label: "فروقات النظام",
                      value: systemAdjustments,
                      pct: sysPct,
                      color: "bg-muted-foreground",
                      text: "text-muted-foreground",
                    },
                  ];
                  return (
                    <Card className="border-border/60 shadow-sm">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <PieChart className="w-4 h-4 text-primary" /> توزيع المصروفات
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {/* Stacked bar */}
                        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div className="bg-blue-500" style={{ width: `${cogsPct}%` }} />
                          <div className="bg-amber-500" style={{ width: `${opPct}%` }} />
                          <div className="bg-muted-foreground" style={{ width: `${sysPct}%` }} />
                        </div>
                        {/* Rows */}
                        <div className="space-y-1.5">
                          {rows.map((r, i) => (
                            <div key={i} className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`w-2 h-2 rounded-full ${r.color} shrink-0`} />
                                <span className="text-[11px] text-muted-foreground truncate">{r.label}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-[11px] font-bold tabular-nums">{formatCurrency(r.value)}</span>
                                <span className={`text-[10px] tabular-nums ${r.text}`}>{r.pct}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}

              {(() => {
                const target = Number((settings as any)?.monthly_sales_target || 0);
                if (target <= 0) return null;
                const progress = Math.min((currentMonthSales / target) * 100, 100);
                const exceeded = currentMonthSales > target;
                return (
                  <Card className="border-border/60 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Target className="w-4 h-4 text-primary" /> هدف المبيعات الشهري
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {loadingKPIs ? (
                        <Skeleton className="h-16 w-full" />
                      ) : (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">المحقق (صافي المبيعات)</span>
                            <span
                              className={`text-sm font-bold tabular-nums ${exceeded ? "text-emerald-600 dark:text-emerald-400" : ""}`}
                            >
                              {formatCurrency(currentMonthSales)}
                            </span>
                          </div>
                          <Progress value={progress} rtl className="h-2" />
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>الهدف: {formatCurrency(target)}</span>
                            <span
                              className={`font-bold ${exceeded ? "text-emerald-600 dark:text-emerald-400" : progress >= 70 ? "text-primary" : "text-destructive"}`}
                            >
                              {progress.toFixed(0)}%
                            </span>
                          </div>
                          {exceeded && (
                            <p className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium rounded-lg p-2 text-center flex items-center justify-center gap-1">
                              <TrendingUp className="w-3 h-3" /> تجاوز الهدف بـ{" "}
                              {formatCurrency(currentMonthSales - target)}
                            </p>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                );
              })()}

              {/* Recent Activities */}
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-semibold">أحدث الحركات</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-0.5">
                  {loadingRight ? (
                    <TableSkeleton rows={3} />
                  ) : recentActivities.length === 0 ? (
                    <EmptyState message="لا توجد حركات بعد" />
                  ) : (
                    recentActivities.map((act) => (
                      <div
                        key={act.id}
                        className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer"
                        onClick={() => navigate(act.type === "sale" ? `/sales/${act.id}` : `/purchases/${act.id}`)}
                      >
                        <div
                          className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${act.type === "sale" ? "bg-emerald-500/10" : "bg-primary/10"}`}
                        >
                          {act.type === "sale" ? (
                            <ArrowDownLeft className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <ArrowUpRight className="w-4 h-4 text-primary" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{act.title}</p>
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3 shrink-0" />
                            {toWesternDigits(
                              formatDistanceToNow(new Date(act.date), {
                                addSuffix: true,
                                locale: ar,
                              }),
                            )}
                            <span className="text-muted-foreground/40 mx-0.5">·</span>
                            <span className="truncate">{act.subtitle}</span>
                          </p>
                        </div>
                        <span
                          className={`text-sm font-bold tabular-nums shrink-0 ${act.type === "sale" ? "text-emerald-600 dark:text-emerald-400" : ""}`}
                        >
                          {act.type === "sale" ? "+" : "−"}
                          {formatCurrency(act.amount)}
                        </span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </ErrorBoundary>

      {/* ═══════════════════════════════════════════════════════════════════════
          ZONE 3 — التنبيهات والمتابعة
          Layout: 2 cols (unpaid · low stock) then stagnant full-width
         ═══════════════════════════════════════════════════════════════════════ */}
      <ErrorBoundary section>
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center gap-2">
              <div className="w-1 h-5 rounded-full bg-destructive" />
              <h2 className="text-sm font-bold text-foreground">التنبيهات والمتابعة</h2>
            </div>
            <div className="flex-1 h-px bg-border/50" />
            <p className="text-[11px] text-muted-foreground shrink-0">تستوجب إجراءً</p>
          </div>

          {/* Aging + Customer Concentration Summary */}
          {(agingBuckets.length > 0 || topCustomers.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
              {/* Aging Summary */}
              {agingBuckets.length > 0 && (
                <Card className="border-border/60 shadow-sm">
                  <CardHeader className="pb-2 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Clock className="w-4 h-4 text-amber-500" />
                      أعمار الذمم المدينة
                    </CardTitle>
                    <SectionLink label="تقرير مفصل" to="/reports/aging" />
                  </CardHeader>
                  <CardContent className="pt-0 pb-3">
                    <div className="grid grid-cols-4 gap-2">
                      {agingBuckets.map((b, i) => {
                        const colors = [
                          "text-emerald-600 bg-emerald-500/10",
                          "text-amber-600 bg-amber-500/10",
                          "text-orange-600 bg-orange-500/10",
                          "text-destructive bg-destructive/10",
                        ];
                        return (
                          <div key={i} className={`rounded-lg p-2.5 text-center ${colors[i].split(" ")[1]}`}>
                            <p className="text-[10px] text-muted-foreground mb-0.5">{b.label}</p>
                            <p className={`text-sm font-bold tabular-nums ${colors[i].split(" ")[0]}`}>
                              {formatCurrency(b.total)}
                            </p>
                            <p className="text-[10px] text-muted-foreground">{b.count} فاتورة</p>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Customer Concentration */}
              {topCustomers.length > 0 && (
                <Card className="border-border/60 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Users className="w-4 h-4 text-blue-500" />
                      تركز العملاء
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 pb-3 space-y-2">
                    {topCustomers.map((c, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-4 shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs font-medium truncate">{c.name}</span>
                            <span className="text-xs font-bold tabular-nums shrink-0">{c.percentage}%</span>
                          </div>
                          <Progress value={c.percentage} rtl className="h-1.5" />
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Row 1 — Unpaid + Low Stock */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            {/* Unpaid Invoices */}
            <Card
              className={`shadow-sm ${unpaidInvoices.length > 0 ? "border-destructive/40 bg-destructive/[0.025]" : "border-border/60"}`}
            >
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ReceiptText
                    className={`w-4 h-4 ${unpaidInvoices.length > 0 ? "text-destructive" : "text-muted-foreground"}`}
                  />
                  فواتير غير مسددة
                </CardTitle>
                <Badge variant={unpaidInvoices.length > 0 ? "destructive" : "outline"} className="text-xs">
                  {unpaidInvoices.length} فاتورة
                </Badge>
              </CardHeader>
              <CardContent className="p-0 max-h-[340px] overflow-auto">
                {loadingTables ? (
                  <TableSkeleton />
                ) : unpaidInvoices.length === 0 ? (
                  <EmptyState message="لا توجد فواتير معلقة ✓" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className={th}>
                        <TableHead className="text-xs">رقم الفاتورة</TableHead>
                        <TableHead className="text-xs">العميل</TableHead>
                        <TableHead className="text-xs text-end">الإجمالي</TableHead>
                        <TableHead className="text-xs text-end">المتبقي</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unpaidInvoices.map((inv) => (
                        <TableRow
                          key={inv.id}
                          className={`${tr} cursor-pointer`}
                          onClick={() => navigate(`/sales/${inv.id}`)}
                        >
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {formatDisplayNumber(
                              settings?.sales_invoice_prefix || "INV-",
                              inv.posted_number,
                              inv.invoice_number,
                              "posted",
                            )}
                          </TableCell>
                          <TableCell className="text-sm font-medium">{inv.customer_name}</TableCell>
                          <TableCell className="text-sm text-end tabular-nums text-muted-foreground">
                            {formatCurrency(inv.total)}
                          </TableCell>
                          <TableCell className="text-sm text-end font-bold tabular-nums text-destructive">
                            {formatCurrency(inv.remaining)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Low Stock */}
            <Card
              className={`shadow-sm ${lowStockItems.length > 0 ? "border-destructive/40 bg-destructive/[0.025]" : "border-border/60"}`}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <AlertTriangle
                    className={`w-4 h-4 ${lowStockItems.length > 0 ? "text-destructive" : "text-muted-foreground"}`}
                  />
                  مخزون منخفض
                  {lowStockItems.length > 0 && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                      {lowStockItems.length}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 max-h-[340px] overflow-auto">
                {loadingTables ? (
                  <TableSkeleton />
                ) : lowStockItems.length === 0 ? (
                  <EmptyState message="المخزون في مستوى آمن ✓" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className={th}>
                        <TableHead className="text-xs">الصنف</TableHead>
                        <TableHead className="text-xs text-center">الكمية الحالية</TableHead>
                        <TableHead className="text-xs text-center">الحد الأدنى</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lowStockItems.map((item, idx) => (
                        <TableRow key={idx} className={tr}>
                          <TableCell className="text-sm font-medium">
                            {formatProductDisplay(item.name, item.brandName, item.modelNumber)}
                          </TableCell>
                          <TableCell className="text-sm font-bold text-destructive text-center tabular-nums">
                            {item.quantity_on_hand}
                          </TableCell>
                          <TableCell className="text-sm text-center tabular-nums text-muted-foreground">
                            {item.min_stock_level}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Row 2 — Stagnant Stock (full width, less urgent but needs readable table) */}
          {(loadingTables || stagnantItems.length > 0) && (
            <Card
              className={`shadow-sm ${stagnantItems.length > 0 ? "border-amber-400/40 bg-amber-50/20 dark:bg-amber-950/10" : "border-border/60"}`}
            >
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <PackageX className="w-4 h-4 text-amber-500" />
                    مخزون راكد
                    {stagnantItems.length > 0 && (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-amber-400/50 text-amber-600 dark:text-amber-400"
                      >
                        {stagnantItems.length} صنف
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="text-[11px] text-muted-foreground mt-0.5">أصناف لم تتحرك منذ أكثر من 30 يوماً</p>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingTables ? (
                  <TableSkeleton />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className={th}>
                        <TableHead className="text-xs">الصنف</TableHead>
                        <TableHead className="text-xs text-center">الكمية المتوفرة</TableHead>
                        <TableHead className="text-xs">آخر حركة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stagnantItems.map((item, idx) => (
                        <TableRow key={idx} className={tr}>
                          <TableCell className="text-sm font-medium">
                            {formatProductDisplay(item.name, item.brandName, item.modelNumber)}
                          </TableCell>
                          <TableCell className="text-sm text-center tabular-nums">{item.quantity_on_hand}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {item.lastMovement ? (
                              toWesternDigits(
                                formatDistanceToNow(new Date(item.lastMovement), {
                                  addSuffix: true,
                                  locale: ar,
                                }),
                              )
                            ) : (
                              <span className="text-destructive/70 text-xs font-medium">لا توجد حركة مسجلة</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </ErrorBoundary>

      {/* ═══════════════════════════════════════════════════════════════════════
          ZONE 4 — أداء المبيعات
          Layout: last-7-days full-width · then products + categories 2-col
         ═══════════════════════════════════════════════════════════════════════ */}
      <ErrorBoundary section>
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center gap-2">
              <div className="w-1 h-5 rounded-full bg-emerald-500" />
              <h2 className="text-sm font-bold text-foreground">أداء المبيعات</h2>
            </div>
            <div className="flex-1 h-px bg-border/50" />
            <button
              onClick={() => navigate("/reports/sales")}
              className="text-xs text-primary/80 hover:text-primary font-medium flex items-center gap-0.5 transition-colors shrink-0"
            >
              تقرير المبيعات
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Last 7 days — full width */}
          <Card className="border-border/60 shadow-sm mb-5">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" /> مبيعات آخر 7 أيام
              </CardTitle>
              <button
                onClick={() => navigate("/reports/sales")}
                className="text-xs text-primary/80 hover:text-primary font-medium flex items-center gap-0.5 transition-colors"
              >
                التفاصيل
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </CardHeader>
            <CardContent className="p-0">
              <Last7DaysSalesTable formatCurrency={formatCurrency} />
            </CardContent>
          </Card>

          {/* Top Products + Top Categories — 2 cols */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card className="border-border/60 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Award className="w-4 h-4 text-primary" /> الأصناف الأكثر مبيعاً
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 max-h-[360px] overflow-auto">
                {loadingTables ? (
                  <TableSkeleton />
                ) : topProducts.length === 0 ? (
                  <EmptyState message="لا توجد بيانات مبيعات" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className={th}>
                        <TableHead className="text-xs w-8 text-center">#</TableHead>
                        <TableHead className="text-xs">الصنف</TableHead>
                        <TableHead className="text-xs text-center">الكمية</TableHead>
                        <TableHead className="text-xs text-end">الإجمالي</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topProducts.map((p, idx) => (
                        <TableRow key={p.product_id} className={tr}>
                          <TableCell className="text-xs text-muted-foreground/50 text-center tabular-nums">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="text-sm font-medium">{p.name}</TableCell>
                          <TableCell className="text-sm text-center tabular-nums">{p.totalQty}</TableCell>
                          <TableCell className="text-sm font-bold text-end tabular-nums">
                            {formatCurrency(p.totalAmount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Package className="w-4 h-4 text-primary" /> الفئات الأكثر ربحية
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 max-h-[360px] overflow-auto">
                {loadingTables ? (
                  <TableSkeleton />
                ) : topCategories.length === 0 ? (
                  <EmptyState message="لا توجد بيانات" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className={th}>
                        <TableHead className="text-xs">الفئة</TableHead>
                        <TableHead className="text-xs text-end">المبيعات</TableHead>
                        <TableHead className="text-xs text-end">الربح</TableHead>
                        <TableHead className="text-xs text-center">الهامش</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topCategories.map((cat) => {
                        const margin = cat.totalSales > 0 ? ((cat.totalProfit / cat.totalSales) * 100).toFixed(0) : "0";
                        return (
                          <TableRow key={cat.name} className={tr}>
                            <TableCell className="text-sm font-medium">{cat.name}</TableCell>
                            <TableCell className="text-sm text-end tabular-nums">
                              {formatCurrency(cat.totalSales)}
                            </TableCell>
                            <TableCell
                              className={`text-sm font-bold text-end tabular-nums ${cat.totalProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
                            >
                              {formatCurrency(cat.totalProfit)}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge
                                variant={Number(margin) > 30 ? "default" : "secondary"}
                                className="text-[10px] tabular-nums"
                              >
                                {margin}%
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </ErrorBoundary>

      {/* ═══════════════════════════════════════════════════════════════════════
          ZONE 5 — التفاصيل المالية
          Layout: expenses 1/3 · account balances 2/3
         ═══════════════════════════════════════════════════════════════════════ */}
      <ErrorBoundary section>
        <div>
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center gap-2">
              <div className="w-1 h-5 rounded-full bg-amber-500" />
              <h2 className="text-sm font-bold text-foreground">التفاصيل المالية</h2>
            </div>
            <div className="flex-1 h-px bg-border/50" />
            <button
              onClick={() => navigate("/reports/profit-loss")}
              className="text-xs text-primary/80 hover:text-primary font-medium flex items-center gap-0.5 transition-colors shrink-0"
            >
              التقارير المالية
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
            {/* Expenses breakdown — 1 col */}
            <Card className="border-border/60 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Banknote className="w-4 h-4 text-destructive" /> تفصيل المصروفات
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loadingRight ? (
                  <TableSkeleton rows={5} />
                ) : expensesByType.length === 0 ? (
                  <EmptyState message="لا توجد مصروفات" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className={th}>
                        <TableHead className="text-xs">النوع</TableHead>
                        <TableHead className="text-xs text-end">المبلغ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expensesByType.map((et) => (
                        <TableRow key={et.name} className={tr}>
                          <TableCell className="text-sm font-medium">{et.name}</TableCell>
                          <TableCell className="text-sm font-bold text-end tabular-nums">
                            {formatCurrency(et.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Account balances — 2 cols */}
            <div className="lg:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <Calculator className="w-4 h-4 text-primary" />
                <p className="text-xs font-semibold text-foreground">ملخص الحسابات</p>
              </div>
              {loadingTables ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-24 w-full rounded-xl" />
                  ))}
                </div>
              ) : accountBalances.length === 0 ? (
                <EmptyState message="لا توجد بيانات حسابات" />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {(() => {
                    const groups: Record<
                      string,
                      {
                        label: string;
                        total: number;
                        icon: React.ElementType;
                        iconBg: string;
                        iconColor: string;
                        accent: string;
                        borderAccent: string;
                      }
                    > = {};
                    const meta: Record<
                      string,
                      {
                        label: string;
                        icon: React.ElementType;
                        iconBg: string;
                        iconColor: string;
                        accent: string;
                        borderAccent: string;
                      }
                    > = {
                      asset: {
                        label: "الأصول",
                        icon: Boxes,
                        iconBg: "bg-primary/10",
                        iconColor: "text-primary",
                        accent: "bg-primary/5",
                        borderAccent: "border-primary/20",
                      },
                      liability: {
                        label: "الخصوم",
                        icon: Landmark,
                        iconBg: "bg-amber-500/10",
                        iconColor: "text-amber-600 dark:text-amber-400",
                        accent: "bg-amber-500/5",
                        borderAccent: "border-amber-400/25",
                      },
                      equity: {
                        label: "حقوق الملكية",
                        icon: Scale,
                        iconBg: "bg-emerald-500/10",
                        iconColor: "text-emerald-600 dark:text-emerald-400",
                        accent: "bg-emerald-500/5",
                        borderAccent: "border-emerald-400/25",
                      },
                      revenue: {
                        label: "الإيرادات",
                        icon: TrendingUp,
                        iconBg: "bg-emerald-500/10",
                        iconColor: "text-emerald-600 dark:text-emerald-400",
                        accent: "bg-emerald-500/5",
                        borderAccent: "border-emerald-400/25",
                      },
                      expense: {
                        label: "المصروفات",
                        icon: Banknote,
                        iconBg: "bg-destructive/10",
                        iconColor: "text-destructive",
                        accent: "bg-destructive/5",
                        borderAccent: "border-destructive/20",
                      },
                    };
                    accountBalances.forEach((acc) => {
                      const k = acc.account_type;
                      const m = meta[k] || {
                        label: k,
                        icon: Calculator,
                        iconBg: "bg-muted",
                        iconColor: "text-muted-foreground",
                        accent: "bg-muted/40",
                        borderAccent: "border-border/60",
                      };
                      if (!groups[k])
                        groups[k] = {
                          label: m.label,
                          total: 0,
                          icon: m.icon,
                          iconBg: m.iconBg,
                          iconColor: m.iconColor,
                          accent: m.accent,
                          borderAccent: m.borderAccent,
                        };
                      groups[k].total += acc.balance;
                    });
                    return Object.entries(groups).map(([key, g]) => {
                      const Icon = g.icon;
                      return (
                        <Card key={key} className={`shadow-sm border ${g.borderAccent} ${g.accent} overflow-hidden`}>
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-2 mb-3">
                              <div
                                className={`w-9 h-9 rounded-xl ${g.iconBg} flex items-center justify-center shrink-0`}
                              >
                                <Icon className={`w-4 h-4 ${g.iconColor}`} />
                              </div>
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0.5 border ${g.total >= 0 ? "border-border/50 text-muted-foreground" : "border-destructive/30 text-destructive"}`}
                              >
                                {g.total >= 0 ? "مدين" : "دائن"}
                              </Badge>
                            </div>
                            <p className="text-[11px] font-medium text-muted-foreground mb-1">{g.label}</p>
                            <p
                              className={`text-base font-extrabold tabular-nums leading-tight ${g.total >= 0 ? "text-foreground" : "text-destructive"}`}
                            >
                              {formatCurrency(Math.abs(g.total))}
                            </p>
                          </CardContent>
                        </Card>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      </ErrorBoundary>
    </div>
  );
}
