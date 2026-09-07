import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import {
  Gauge,
  AlertTriangle,
  RefreshCw,
  Repeat,
  CalendarClock,
  Percent,
  Coins,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/ui/data-table";
import { ExportMenu } from "@/components/ExportMenu";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DatePickerInput } from "@/components/DatePickerInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { ReportPurposeBar } from "@/components/shared/ReportPurposeBar";
import { productReportFilterFn } from "@/lib/report-filters";
import { supabase } from "@/integrations/supabase/client";

import { useSettings } from "@/contexts/SettingsContext";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────

type AbcClass = "A" | "B" | "C";

interface KpiRow {
  product_id: string;
  code: string;
  name: string;
  model_number: string | null;
  brand_name: string | null;
  category_name: string | null;
  revenue: number;
  sold_qty: number;
  cogs: number;
  gross_profit: number;
  quantity: number;
  stock_value: number;
  abc_class: AbcClass;
}

interface KpiResult {
  date_from: string;
  date_to: string;
  period_days: number;
  opening_value: number;
  closing_value: number;
  average_value: number;
  purchases_value: number;
  cogs: number;
  revenue: number;
  gross_profit: number;
  turnover: number | null;
  dio: number | null;
  gmroi: number | null;
  rows: KpiRow[];
}

const ABC_META: Record<AbcClass, { label: string; className: string; hint: string }> = {
  A: {
    label: "A",
    className: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
    hint: "80% من المبيعات — متابعة يومية ولا يُسمح بنفادها",
  },
  B: {
    label: "B",
    className: "border-sky-300 text-sky-700 dark:text-sky-400",
    hint: "15% التالية — متابعة أسبوعية",
  },
  C: {
    label: "C",
    className: "border-muted-foreground/30 text-muted-foreground",
    hint: "5% الأخيرة أو بلا مبيعات — تخفيض المخزون منها",
  },
};

const num = (v: unknown) => Number(v ?? 0);
const fmtNum = (v: number) =>
  num(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (v: number) =>
  num(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const todayISO = () => new Date().toISOString().slice(0, 10);
const yearStartISO = () => `${new Date().getFullYear()}-01-01`;

export default function InventoryKpisPage() {
  const { formatCurrency, settings } = useSettings();

  const [dateFrom, setDateFrom] = useState<string>(yearStartISO());
  const [dateTo, setDateTo] = useState<string>(todayISO());
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<KpiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abc, setAbc] = useState<"all" | AbcClass>("all");
  const [category, setCategory] = useState("all");
  const [brand, setBrand] = useState("all");
  const [search, setSearch] = useState("");

  const load = async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    const { data: res, error: err } = await (supabase.rpc as any)("get_inventory_kpis", {
      p_date_from: from,
      p_date_to: to,
    });
    if (err) {
      setError(err.message);
      setData(null);
      notify.error("تعذر تحميل مؤشرات المخزون", err.message);
    } else {
      const p = res as KpiResult;
      setData({
        date_from: p?.date_from ?? from,
        date_to: p?.date_to ?? to,
        period_days: num(p?.period_days),
        opening_value: num(p?.opening_value),
        closing_value: num(p?.closing_value),
        average_value: num(p?.average_value),
        purchases_value: num(p?.purchases_value),
        cogs: num(p?.cogs),
        revenue: num(p?.revenue),
        gross_profit: num(p?.gross_profit),
        turnover: p?.turnover === null || p?.turnover === undefined ? null : num(p.turnover),
        dio: p?.dio === null || p?.dio === undefined ? null : num(p.dio),
        gmroi: p?.gmroi === null || p?.gmroi === undefined ? null : num(p.gmroi),
        rows: (p?.rows ?? []).map((r) => ({
          ...r,
          revenue: num(r.revenue),
          sold_qty: num(r.sold_qty),
          cogs: num(r.cogs),
          gross_profit: num(r.gross_profit),
          quantity: num(r.quantity),
          stock_value: num(r.stock_value),
        })),
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    load(dateFrom, dateTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  const rows = data?.rows ?? [];

  const categories = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category_name).filter(Boolean))) as string[],
    [rows],
  );
  const brands = useMemo(
    () => Array.from(new Set(rows.map((r) => r.brand_name).filter(Boolean))) as string[],
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (abc !== "all" && r.abc_class !== abc) return false;
        if (category !== "all" && (r.category_name ?? "") !== category) return false;
        if (brand !== "all" && (r.brand_name ?? "") !== brand) return false;
        return true;
      }),
    [rows, abc, category, brand],
  );

  const abcSummary = useMemo(() => {
    const base: Record<AbcClass, { count: number; revenue: number; stockValue: number }> = {
      A: { count: 0, revenue: 0, stockValue: 0 },
      B: { count: 0, revenue: 0, stockValue: 0 },
      C: { count: 0, revenue: 0, stockValue: 0 },
    };
    for (const r of rows) {
      base[r.abc_class].count += 1;
      base[r.abc_class].revenue += r.revenue;
      base[r.abc_class].stockValue += r.stock_value;
    }
    return base;
  }, [rows]);

  const totalRevenue = abcSummary.A.revenue + abcSummary.B.revenue + abcSummary.C.revenue;
  const totalStockValue =
    abcSummary.A.stockValue + abcSummary.B.stockValue + abcSummary.C.stockValue;

  const marginPct = data && data.revenue > 0 ? (data.gross_profit / data.revenue) * 100 : 0;
  const turnover = data?.turnover ?? null;
  const turnoverHealth: "good" | "warn" | "bad" =
    turnover === null ? "warn" : turnover >= 4 ? "good" : turnover >= 2 ? "warn" : "bad";

  const columns = useMemo<ColumnDef<KpiRow>[]>(
    () => [
      {
        accessorKey: "code",
        header: "الكود",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.code}</span>
        ),
      },
      {
        accessorKey: "name",
        header: "الصنف",
        cell: ({ row }) => (
          <div className="min-w-[180px]">
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">
              {[row.original.brand_name, row.original.model_number]
                .filter(Boolean)
                .join(" • ") || "—"}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "abc_class",
        header: "التصنيف",
        cell: ({ row }) => {
          const meta = ABC_META[row.original.abc_class];
          return (
            <Badge variant="outline" className={meta.className}>
              {meta.label}
            </Badge>
          );
        },
      },
      {
        accessorKey: "sold_qty",
        header: "الكمية المبيعة",
        cell: ({ row }) => (
          <span className="tabular-nums">{fmtQty(row.original.sold_qty)}</span>
        ),
      },
      {
        accessorKey: "revenue",
        header: "صافي المبيعات",
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums">{fmtNum(row.original.revenue)}</span>
        ),
      },
      {
        accessorKey: "cogs",
        header: "تكلفة المبيعات",
        cell: ({ row }) => (
          <span className="tabular-nums">{fmtNum(row.original.cogs)}</span>
        ),
        meta: { hideOnMobile: true },
      },
      {
        accessorKey: "gross_profit",
        header: "الربح الإجمالي",
        cell: ({ row }) => {
          const gp = row.original.gross_profit;
          const pct = row.original.revenue > 0 ? (gp / row.original.revenue) * 100 : 0;
          return (
            <div className="text-sm">
              <div
                className={cn(
                  "font-semibold tabular-nums",
                  gp < 0 && "text-red-600 dark:text-red-400",
                )}
              >
                {fmtNum(gp)}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {row.original.revenue > 0 ? `${pct.toFixed(1)}%` : "—"}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "quantity",
        header: "المتاح",
        cell: ({ row }) => (
          <span className="tabular-nums">{fmtQty(row.original.quantity)}</span>
        ),
      },
      {
        accessorKey: "stock_value",
        header: "قيمة المخزون",
        cell: ({ row }) => (
          <span className="tabular-nums">{fmtNum(row.original.stock_value)}</span>
        ),
      },
    ],
    [],
  );

  const exportConfig = useMemo(
    () => ({
      filenamePrefix: "inventory-kpis",
      sheetName: "مؤشرات المخزون",
      pdfTitle: `مؤشرات المخزون وتصنيف ABC (${dateFrom} — ${dateTo})`,
      headers: [
        "الكود",
        "الصنف",
        "الماركة",
        "رقم الموديل",
        "الفئة",
        "التصنيف",
        "الكمية المبيعة",
        "صافي المبيعات",
        "تكلفة المبيعات",
        "الربح الإجمالي",
        "المتاح",
        "قيمة المخزون",
      ],
      rows: filtered.map((r) => [
        r.code,
        r.name,
        r.brand_name || "-",
        r.model_number || "-",
        r.category_name || "-",
        r.abc_class,
        fmtQty(r.sold_qty),
        fmtNum(r.revenue),
        fmtNum(r.cogs),
        fmtNum(r.gross_profit),
        fmtQty(r.quantity),
        fmtNum(r.stock_value),
      ]),
      settings,
      summaryCards: [
        { label: "معدل الدوران", value: turnover === null ? "—" : fmtQty(turnover) },
        { label: "أيام التغطية DIO", value: data?.dio === null || !data ? "—" : fmtQty(data.dio!) },
        { label: "الربح الإجمالي", value: fmtNum(data?.gross_profit ?? 0) },
        { label: "متوسط قيمة المخزون", value: fmtNum(data?.average_value ?? 0) },
      ],
      pdfOrientation: "landscape" as const,
    }),
    [filtered, settings, data, turnover, dateFrom, dateTo],
  );

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={Gauge}
        title="مؤشرات المخزون وتصنيف ABC"
        description={`الدوران وأيام التغطية والعائد على المخزون خلال ${data?.period_days ?? 0} يومًا — التكلفة بالمتوسط المرجح (WAC)`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => load(dateFrom, dateTo)}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4 ml-2", loading && "animate-spin")} />
              تحديث
            </Button>
            <ExportMenu config={exportConfig} disabled={loading || filtered.length === 0} />
          </>
        }
      />

      <ReportPurposeBar
        what="مؤشرات أداء المخزون خلال فترة: معدل الدوران، أيام التغطية (DIO)، هامش الربح، والعائد على الاستثمار في المخزون (GMROI)، مع تصنيف ABC للأصناف."
        decision="تحديد الأصناف التي تستحق التركيز في الشراء والتسعير (A)، والأصناف التي تستهلك رأس المال بدون عائد (C)، وقياس كفاءة إدارة المخزون."
        basis="التكلفة بالمتوسط المرجح (WAC) من حركات المخزون. الدوران = تكلفة المبيعات ÷ متوسط قيمة المخزون. تصنيف ABC بأسلوب باريتو على المبيعات التراكمية."
        note="أيام التغطية المستهدفة وحدود الفترات قابلة للضبط من إعدادات المخزون."
      />

      {/* المؤشرات الأربعة */}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="معدل دوران المخزون"
          value={turnover === null ? "—" : `${fmtQty(turnover)} مرة`}
          icon={Repeat}
          tone="primary"
          sub="تكلفة المبيعات ÷ متوسط قيمة المخزون"
        />
        <StatCard
          label="أيام التغطية (DIO)"
          value={data?.dio === null || !data ? "—" : `${fmtQty(data.dio!)} يوم`}
          icon={CalendarClock}
          tone="blue"
          sub="365 ÷ معدل الدوران"
        />
        <StatCard
          label="هامش الربح الإجمالي"
          value={`${marginPct.toFixed(1)}%`}
          icon={Percent}
          tone="emerald"
          sub={`ربح ${formatCurrency(data?.gross_profit ?? 0)}`}
        />
        <StatCard
          label="العائد على المخزون (GMROI)"
          value={data?.gmroi === null || !data ? "—" : fmtQty(data.gmroi!)}
          icon={Coins}
          tone="orange"
          sub="الربح الإجمالي ÷ متوسط قيمة المخزون"
        />
      </div>

      {/* شريط القراءة والقرار */}
      <Card
        className={cn(
          "border-r-4 rounded-xl",
          turnoverHealth === "good"
            ? "border-r-emerald-500"
            : turnoverHealth === "warn"
              ? "border-r-amber-500"
              : "border-r-red-500",
        )}
      >
        <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
          <div className="flex items-start gap-3">
            <Gauge
              className={cn(
                "h-5 w-5 mt-0.5",
                turnoverHealth === "good"
                  ? "text-emerald-600"
                  : turnoverHealth === "warn"
                    ? "text-amber-600"
                    : "text-red-600",
              )}
            />
            <div>
              <div className="font-semibold">
                {turnover === null
                  ? "لا يمكن حساب الدوران — لا توجد قيمة مخزون في الفترة"
                  : turnoverHealth === "good"
                    ? `دوران جيد (${fmtQty(turnover)} مرة): المخزون يتحرك ورأس المال لا يتجمد`
                    : turnoverHealth === "warn"
                      ? `دوران متوسط (${fmtQty(turnover)} مرة): راجع الأصناف من فئة C قبل أي شراء جديد`
                      : `دوران منخفض (${fmtQty(turnover)} مرة): المخزون يبتلع رأس المال — أوقف شراء فئة C وصفِّ الراكد`}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                مخزون أول الفترة {fmtNum(data?.opening_value ?? 0)} • مشتريات{" "}
                {fmtNum(data?.purchases_value ?? 0)} • تكلفة مبيعات {fmtNum(data?.cogs ?? 0)} •
                مخزون آخر الفترة {fmtNum(data?.closing_value ?? 0)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <div className="text-xs text-muted-foreground">صافي المبيعات</div>
              <div className="font-bold tabular-nums">{fmtNum(data?.revenue ?? 0)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">متوسط قيمة المخزون</div>
              <div className="font-bold tabular-nums">{fmtNum(data?.average_value ?? 0)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* تصنيف ABC */}
      <Card className="rounded-xl">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">تصنيف ABC حسب صافي المبيعات (باريتو)</div>
            <button
              type="button"
              onClick={() => setAbc("all")}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              إظهار الكل
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(["A", "B", "C"] as AbcClass[]).map((cls) => {
              const s = abcSummary[cls];
              const revPct = totalRevenue > 0 ? (s.revenue / totalRevenue) * 100 : 0;
              const stockPct = totalStockValue > 0 ? (s.stockValue / totalStockValue) * 100 : 0;
              return (
                <button
                  key={cls}
                  type="button"
                  onClick={() => setAbc(abc === cls ? "all" : cls)}
                  className={cn(
                    "text-right rounded-lg border p-3 transition-colors hover:bg-muted/60",
                    abc === cls && "bg-muted",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className={ABC_META[cls].className}>
                      فئة {cls}
                    </Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {s.count} صنف
                    </span>
                  </div>
                  <div className="mt-2 text-sm tabular-nums">
                    مبيعات {fmtNum(s.revenue)} ({revPct.toFixed(1)}%)
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    قيمة مخزون {fmtNum(s.stockValue)} ({stockPct.toFixed(1)}%)
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        cls === "A"
                          ? "bg-emerald-500"
                          : cls === "B"
                            ? "bg-sky-500"
                            : "bg-muted-foreground/40",
                      )}
                      style={{ width: `${Math.min(100, revPct)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{ABC_META[cls].hint}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* الجدول */}
      {error ? (
        <EmptyState
          icon={AlertTriangle}
          title="تعذر تحميل التقرير"
          description={error}
          action={<Button onClick={() => load(dateFrom, dateTo)}>إعادة المحاولة</Button>}
        />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          isLoading={loading}
          getRowId={(r) => r.product_id}
          globalFilter={search}
          onGlobalFilterChange={setSearch}
          globalFilterFn={productReportFilterFn}
          searchPlaceholder="بحث بالكود أو الاسم أو الماركة أو رقم الموديل..."
          pageSize={25}
          compactRows
          emptyMessage="لا توجد بيانات في هذه الفترة"
          toolbarStart={
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-[150px]">
                <DatePickerInput
                  value={dateFrom}
                  onChange={(v) => setDateFrom(v || yearStartISO())}
                />
              </div>
              <div className="w-[150px]">
                <DatePickerInput value={dateTo} onChange={(v) => setDateTo(v || todayISO())} />
              </div>
              <Select value={abc} onValueChange={(v) => setAbc(v as typeof abc)}>
                <SelectTrigger className="w-[130px] h-9">
                  <SelectValue placeholder="التصنيف" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل التصنيفات</SelectItem>
                  <SelectItem value="A">فئة A</SelectItem>
                  <SelectItem value="B">فئة B</SelectItem>
                  <SelectItem value="C">فئة C</SelectItem>
                </SelectContent>
              </Select>
              <SearchableSelect
                value={category}
                onChange={setCategory}
                options={categories}
                allLabel="كل الفئات"
                searchPlaceholder="بحث في الفئات..."
                className="w-[150px]"
              />
              <SearchableSelect
                value={brand}
                onChange={setBrand}
                options={brands}
                allLabel="كل الماركات"
                searchPlaceholder="بحث في الماركات..."
                className="w-[150px]"
              />

            </div>
          }
        />
      )}
    </div>
  );
}
