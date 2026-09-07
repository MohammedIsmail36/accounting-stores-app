
import { useEffect, useMemo, useState } from "react";
import { StatCard } from "@/components/StatCard";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/contexts/SettingsContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/ui/data-table";
import { ExportMenu } from "@/components/ExportMenu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ColumnDef } from "@tanstack/react-table";
import {
  Scale,
  TrendingUp,
  TrendingDown,
  Building2,
  Banknote,
  Info,
  CheckCircle2,
  AlertTriangle,
  Layers,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────

interface AccountBalance {
  id: string;
  code: string;
  name: string;
  account_type: string;
  parent_id?: string | null;
  is_parent?: boolean;
  debit: number;
  credit: number;
  balance: number;
}

// ─── Constants ────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  asset: "الأصول",
  liability: "الخصوم",
  equity: "حقوق الملكية",
  revenue: "الإيرادات",
  expense: "المصروفات",
};

const TYPE_COLORS: Record<string, string> = {
  asset: "bg-blue-100    text-blue-700    dark:bg-blue-500/15    dark:text-blue-400",
  liability: "bg-orange-100  text-orange-700  dark:bg-orange-500/15  dark:text-orange-400",
  equity: "bg-purple-100  text-purple-700  dark:bg-purple-500/15  dark:text-purple-400",
  revenue: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  expense: "bg-red-100     text-red-700     dark:bg-red-500/15     dark:text-red-400",
};

// Prefix codes for cash/bank accounts — adjust to your chart of accounts
const CASH_CODE_PREFIXES = ["1101", "1102"];

// ─── Formatters ───────────────────────────────────────────

const fmt = (v: number) =>
  Number(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const compactFmt = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return fmt(v);
};

// ─── Filter persistence ───────────────────────────────────

const LS_KEY = "account_balances_filters_v2";

function loadFilters(): { typeFilter: string; showZero: boolean } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { typeFilter: "all", showZero: false };
}

function saveFilters(typeFilter: string, showZero: boolean) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ typeFilter, showZero }));
  } catch {
    /* ignore */
  }
}

// ─── Main component ───────────────────────────────────────

export default function AccountBalancesReport() {
  const { currency, settings } = useSettings();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<AccountBalance[]>([]);

  const savedFilters = useMemo(() => loadFilters(), []);
  const [typeFilter, setTypeFilter] = useState(savedFilters.typeFilter);
  const [showZero, setShowZero] = useState(savedFilters.showZero);

  const handleTypeFilter = (v: string) => {
    setTypeFilter(v);
    saveFilters(v, showZero);
  };
  const handleShowZero = () => {
    const next = !showZero;
    setShowZero(next);
    saveFilters(typeFilter, next);
  };

  // ── Data fetch ────────────────────────────────────────

  const loadBalances = async (
    isCancelled: () => boolean = () => false,
  ): Promise<void> => {
    setLoading(true);
    setError(null);

    const [balRes, accRes] = await Promise.all([
      (supabase.rpc as any)("get_account_balances", {
        p_only_with_activity: false,
      }),
      supabase
        .from("accounts")
        .select("id, code, name, account_type, parent_id, is_parent")
        .order("code"),
    ]);

    if (isCancelled()) return;

    if (balRes.error || accRes.error) {
      const msg =
        balRes.error?.message ?? accRes.error?.message ?? "خطأ غير معروف";
      setError(`فشل تحميل البيانات: ${msg}`);
      setLoading(false);
      return;
    }

    const rows = ((balRes.data?.rows ?? []) as any[]).map((r) => ({
      ...r,
      debit: Number(r.debit),
      credit: Number(r.credit),
      balance: Number(r.balance),
    }));

    const accMap = new Map<string, any>();
    (accRes.data ?? []).forEach((a) => accMap.set(a.id, a));

    const merged: AccountBalance[] = rows.map((r) => ({
      ...r,
      parent_id: accMap.get(r.id)?.parent_id ?? null,
      is_parent: accMap.get(r.id)?.is_parent ?? false,
    }));

    const existingIds = new Set(merged.map((m) => m.id));
    (accRes.data ?? []).forEach((a) => {
      if (!existingIds.has(a.id) && !a.is_parent) {
        merged.push({
          id: a.id,
          code: a.code,
          name: a.name,
          account_type: a.account_type,
          parent_id: a.parent_id,
          is_parent: a.is_parent,
          debit: 0,
          credit: 0,
          balance: 0,
        });
      }
    });

    setBalances(merged);
    setLoading(false);
  };

  const fetchData = () => loadBalances();

  useEffect(() => {
    let cancelled = false;
    void loadBalances(() => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Aggregate by type ─────────────────────────────────

  const typeTotals = useMemo(() => {
    const t: Record<string, number> = {
      asset: 0,
      liability: 0,
      equity: 0,
      revenue: 0,
      expense: 0,
    };
    balances.forEach((b) => {
      t[b.account_type] = (t[b.account_type] ?? 0) + b.balance;
    });
    return t;
  }, [balances]);

  // ── KPIs ──────────────────────────────────────────────

  const kpis = useMemo(() => {
    /*
     * ══════════════════════════════════════════════════════
     * الإصلاح الجذري لحساب صافي الربح
     * ══════════════════════════════════════════════════════
     *
     * get_account_balances قد يُعيد الإيرادات والمصروفات
     * كأرقام سالبة (طبيعة دائنة في DB).
     *
     * مثال على البيانات الفعلية:
     *   typeTotals.revenue  = -63,560   ← سالب
     *   typeTotals.expense  = -48,879   ← سالب
     *
     * ❌ الخطأ الأول:
     *    totalRevenue - totalExpense
     *    = -63,560 - (-48,879) = -14,681  ← علامة خاطئة
     *
     * ❌ الخطأ الثاني (النسخة السابقة من الكود):
     *    totalRevenue - Math.abs(expense)
     *    = -63,560 - 48,879 = -112,439   ← يجمع!
     *
     * ✅ الصحيح: Math.abs على الاثنين معاً ثم الطرح
     *    Math.abs(revenue) - Math.abs(expense)
     *    = 63,560 - 48,879 = +14,681     ✓
     */
    const revenueAmount = Math.abs(typeTotals.revenue ?? 0);
    const expenseAmount = Math.abs(typeTotals.expense ?? 0);
    const netProfit = revenueAmount - expenseAmount;

    const totalAssets = Math.abs(typeTotals.asset ?? 0);
    const totalLiabilities = Math.abs(typeTotals.liability ?? 0);
    const totalEquity = Math.abs(typeTotals.equity ?? 0);

    // السيولة: بالكود لا بالاسم (أدق وأأمن)
    const liquidity = balances
      .filter((b) => b.account_type === "asset" && CASH_CODE_PREFIXES.some((p) => b.code.startsWith(p)))
      .reduce((s, b) => s + Math.abs(b.balance), 0);

    const debtRatio = totalAssets > 0 ? (totalLiabilities / totalAssets) * 100 : 0;
    const equationDiff = totalAssets - (totalLiabilities + totalEquity + netProfit);

    return {
      totalAssets,
      totalLiabilities,
      totalEquity,
      revenueAmount,
      expenseAmount,
      netProfit,
      liquidity,
      debtRatio,
      equationDiff,
      isBalanced: Math.abs(equationDiff) < 1,
    };
  }, [typeTotals, balances]);

  // ── Filtered list ─────────────────────────────────────

  const filtered = useMemo(
    () =>
      balances
        .filter((acc) => {
          if (acc.is_parent) return false;
          if (typeFilter !== "all" && acc.account_type !== typeFilter) return false;
          if (!showZero && Math.abs(acc.balance) < 0.01) return false;
          return true;
        })
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)),
    [balances, typeFilter, showZero],
  );

  // Top 10 always from ALL leaf accounts (stable scale regardless of filter)
  const allLeafSorted = useMemo(
    () => balances.filter((b) => !b.is_parent).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)),
    [balances],
  );

  const top10 = useMemo(() => allLeafSorted.slice(0, 10), [allLeafSorted]);
  const top10Max = useMemo(() => Math.max(1, ...top10.map((a) => Math.abs(a.balance))), [top10]);

  // ── Table columns ─────────────────────────────────────

  const columns = useMemo<ColumnDef<AccountBalance>[]>(() => {
    const typeTotal = (t: string) => Math.abs(typeTotals[t] ?? 0) || 1;
    return [
      {
        accessorKey: "code",
        header: "الرمز",
        cell: ({ getValue }) => <span className="font-mono text-xs text-muted-foreground">{getValue() as string}</span>,
      },
      {
        accessorKey: "name",
        header: "اسم الحساب",
        cell: ({ row }) => <span className="text-sm font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: "account_type",
        header: "النوع",
        cell: ({ getValue }) => {
          const t = getValue() as string;
          return (
            <Badge variant="secondary" className={cn("text-[11px] font-normal", TYPE_COLORS[t])}>
              {TYPE_LABELS[t] ?? t}
            </Badge>
          );
        },
      },
      {
        accessorKey: "debit",
        header: "مدين",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <span
              className={cn("tabular-nums text-sm font-mono", v > 0 ? "text-foreground" : "text-muted-foreground/40")}
            >
              {v > 0 ? fmt(v) : "—"}
            </span>
          );
        },
      },
      {
        accessorKey: "credit",
        header: "دائن",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <span
              className={cn("tabular-nums text-sm font-mono", v > 0 ? "text-foreground" : "text-muted-foreground/40")}
            >
              {v > 0 ? fmt(v) : "—"}
            </span>
          );
        },
      },
      {
        accessorKey: "balance",
        header: "الرصيد",
        cell: ({ row }) => {
          const v = row.original.balance;
          return (
            <span
              className={cn(
                "tabular-nums font-bold text-sm font-mono",
                v >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
              )}
            >
              {fmt(Math.abs(v))}
              <span className="text-[10px] font-normal text-muted-foreground mr-1">{v >= 0 ? "مدين" : "دائن"}</span>
            </span>
          );
        },
      },
      {
        id: "share",
        header: "% من النوع",
        cell: ({ row }) => {
          const v = Math.abs(row.original.balance);
          const tot = typeTotal(row.original.account_type);
          const pct = (v / tot) * 100;
          return (
            <div className="flex items-center gap-2 min-w-[100px]">
              <Progress value={Math.min(100, pct)} className="h-1.5 w-16" />
              <span className="text-[11px] tabular-nums text-muted-foreground w-10">{pct.toFixed(1)}%</span>
            </div>
          );
        },
      },
    ];
  }, [typeTotals]);

  // ── Export ────────────────────────────────────────────

  const exportConfig = useMemo(
    () => ({
      filenamePrefix: "أرصدة-الحسابات",
      sheetName: "أرصدة الحسابات",
      pdfTitle: "تقرير أرصدة الحسابات",
      headers: ["الرمز", "اسم الحساب", "النوع", "مدين", "دائن", "الرصيد", "الجانب"],
      rows: filtered.map((a) => [
        a.code,
        a.name,
        TYPE_LABELS[a.account_type] ?? a.account_type,
        a.debit,
        a.credit,
        Math.abs(a.balance),
        a.balance >= 0 ? "مدين" : "دائن",
      ]),
      summaryCards: [
        { label: "إجمالي الأصول", value: fmt(kpis.totalAssets) },
        { label: "إجمالي الخصوم", value: fmt(kpis.totalLiabilities) },
        { label: "حقوق الملكية", value: fmt(kpis.totalEquity) },
        { label: "إجمالي الإيرادات", value: fmt(kpis.revenueAmount) },
        { label: "إجمالي المصروفات", value: fmt(kpis.expenseAmount) },
        { label: "صافي الربح", value: fmt(kpis.netProfit) },
      ],
      settings,
      pdfOrientation: "landscape" as const,
    }),
    [filtered, kpis, settings],
  );

  // ── Loading state ─────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-3 pb-3 px-3">
                <Skeleton className="h-14 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-3 text-center">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <p className="text-sm font-medium text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="gap-2" onClick={fetchData}>
            <RefreshCw className="h-3.5 w-3.5" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Render ────────────────────────────────────────────

  return (
    <TooltipProvider>
      <div className="space-y-5">
        {/* ── KPI Cards ───────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiCard
            label="إجمالي الأصول"
            value={fmt(kpis.totalAssets)}
            currency={currency}
            icon={Building2}
            tone="blue"
            hint="مجموع كل ما تملكه الشركة من نقد ومخزون وعملاء وأصول ثابتة"
          />
          <KpiCard
            label="إجمالي الخصوم"
            value={fmt(kpis.totalLiabilities)}
            currency={currency}
            icon={TrendingDown}
            tone="orange"
            hint="مجموع التزامات الشركة (موردين، قروض)"
          />
          <KpiCard
            label="حقوق الملكية"
            value={fmt(kpis.totalEquity)}
            currency={currency}
            icon={Layers}
            tone="purple"
            hint="رأس المال + الأرباح المحتجزة"
          />
          <KpiCard
            label="صافي الربح"
            value={fmt(kpis.netProfit)}
            currency={currency}
            icon={kpis.netProfit >= 0 ? TrendingUp : TrendingDown}
            tone={kpis.netProfit >= 0 ? "emerald" : "red"}
            hint={`إيرادات ${fmt(kpis.revenueAmount)} − مصروفات ${fmt(kpis.expenseAmount)}`}
            valueClass={kpis.netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}
          />
          <KpiCard
            label="السيولة المتاحة"
            value={fmt(kpis.liquidity)}
            currency={currency}
            icon={Banknote}
            tone="emerald"
            hint="مجموع أرصدة حسابات النقدية والبنوك (10xx – 11xx)"
          />
          <KpiCard
            label="نسبة الدين"
            value={kpis.debtRatio.toFixed(1) + "%"}
            currency=""
            icon={Scale}
            tone={kpis.debtRatio > 70 ? "red" : kpis.debtRatio > 40 ? "orange" : "emerald"}
            hint="نسبة الخصوم إلى الأصول — فوق 50% يعني مخاطر مرتفعة"
            valueClass={
              kpis.debtRatio > 70 ? "text-destructive" : kpis.debtRatio > 40 ? "text-orange-600" : "text-emerald-600"
            }
          />
        </div>

        {/* ── Accounting Equation ─────────────────────── */}
        <Card className="border shadow-sm">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Scale className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">معادلة الميزانية</h3>
                {kpis.isBalanced ? (
                  <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 text-[10px] gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    متوازنة
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="text-[10px] gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    فرق {fmt(Math.abs(kpis.equationDiff))}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">الأصول = الخصوم + حقوق الملكية + صافي الدخل</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
              <div className="rounded-lg border bg-blue-50/50 dark:bg-blue-500/5 p-3">
                <p className="text-[11px] text-muted-foreground mb-1">الأصول</p>
                <p className="text-lg font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                  {fmt(kpis.totalAssets)}
                  <span className="text-xs font-normal text-muted-foreground mr-1">{currency}</span>
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-[11px] text-muted-foreground mb-2">المصادر</p>
                <StackedBar
                  segments={[
                    { label: "خصوم", value: kpis.totalLiabilities, color: "bg-orange-400" },
                    { label: "حقوق ملكية", value: kpis.totalEquity, color: "bg-purple-400" },
                    {
                      label: kpis.netProfit >= 0 ? "ربح" : "خسارة",
                      value: Math.abs(kpis.netProfit),
                      color: kpis.netProfit >= 0 ? "bg-emerald-400" : "bg-red-400",
                    },
                  ]}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Top 10 Chart ─────────────────────────────── */}
        <Card className="border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">أعلى 10 حسابات بالرصيد</h3>
              <span className="text-[10px] text-muted-foreground">(المقياس ثابت — مستقل عن الفلتر)</span>
            </div>
            {top10.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">لا توجد بيانات</p>
            ) : (
              <div className="space-y-1.5">
                {top10.map((a) => {
                  const v = Math.abs(a.balance);
                  const pct = (v / top10Max) * 100;
                  return (
                    <div key={a.id} className="grid grid-cols-[1fr_auto] gap-3 items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium truncate">{a.name}</span>
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">{a.code}</span>
                          <Badge
                            variant="secondary"
                            className={cn("text-[9px] px-1.5 py-0 h-4 shrink-0", TYPE_COLORS[a.account_type])}
                          >
                            {TYPE_LABELS[a.account_type]}
                          </Badge>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              a.balance >= 0 ? "bg-primary" : "bg-destructive/70",
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <span className="tabular-nums font-mono font-semibold text-sm shrink-0 w-28 text-end">
                        {compactFmt(v)} {currency}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Filters + Table ─────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={typeFilter} onValueChange={handleTypeFilter}>
                <SelectTrigger className="w-44 h-8 text-xs">
                  <SelectValue placeholder="نوع الحساب" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الأنواع</SelectItem>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant={showZero ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs"
                onClick={handleShowZero}
              >
                {showZero ? "إخفاء الأصفار" : "إظهار حسابات صفرية"}
              </Button>

              <Badge variant="secondary" className="text-[11px] gap-1">
                <Info className="h-3 w-3" />
                {filtered.length} حساب
              </Badge>
            </div>
            <ExportMenu config={exportConfig} />
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            showSearch
            searchPlaceholder="بحث بالاسم أو الرمز..."
            emptyMessage="لا توجد حسابات مطابقة"
            pageSize={20}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

// ─── KpiCard ──────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  currency: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "blue" | "orange" | "purple" | "emerald" | "red";
  hint?: string;
  valueClass?: string;
}

function KpiCard({ label, value, currency, icon, tone, hint, valueClass }: KpiCardProps) {
  return (
    <StatCard
      icon={icon}
      label={label}
      value={value}
      sub={currency || undefined}
      hint={hint}
      tone={tone}
      valueClass={valueClass}
    />
  );
}

// ─── StackedBar ───────────────────────────────────────────

interface StackedBarProps {
  segments: { label: string; value: number; color: string }[];
}

function StackedBar({ segments }: StackedBarProps) {
  const total = segments.reduce((s, x) => s + Math.abs(x.value), 0) || 1;
  return (
    <div>
      <div className="h-3 w-full rounded-full overflow-hidden flex bg-muted">
        {segments.map((s, i) => {
          const pct = (Math.abs(s.value) / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={i}
              className={cn("h-full transition-all", s.color)}
              style={{ width: `${pct}%` }}
              title={`${s.label}: ${fmt(Math.abs(s.value))} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {segments.map((s, i) => {
          const pct = (Math.abs(s.value) / total) * 100;
          return (
            <div key={i} className="flex items-center gap-1.5 text-[11px]">
              <span className={cn("w-2 h-2 rounded-sm shrink-0", s.color)} />
              <span className="text-muted-foreground">{s.label}:</span>
              <span className="font-mono font-medium tabular-nums">{fmt(Math.abs(s.value))}</span>
              <span className="text-muted-foreground">({pct.toFixed(1)}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
