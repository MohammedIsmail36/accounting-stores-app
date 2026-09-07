import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import {
  Hourglass,
  AlertTriangle,
  RefreshCw,
  Snowflake,
  TrendingDown,
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

type AgingBucket = "0-30" | "31-60" | "61-90" | "91-180" | "180+";
type AgingStatus = "moving" | "slow" | "dead";

interface AgingRow {
  product_id: string;
  code: string;
  name: string;
  model_number: string | null;
  brand_name: string | null;
  category_name: string | null;
  quantity: number;
  unit_cost: number;
  value: number;
  last_receipt_date: string | null;
  last_sale_date: string | null;
  age_days: number | null;
  days_since_sale: number | null;
  bucket: AgingBucket;
  status: AgingStatus;
  selling_price: number;
  nrv_margin: number;
}

interface AgingResult {
  as_of: string;
  slow_days: number;
  dead_days: number;
  rows: AgingRow[];
}

const BUCKETS: AgingBucket[] = ["0-30", "31-60", "61-90", "91-180", "180+"];
const BUCKET_LABELS: Record<AgingBucket, string> = {
  "0-30": "0-30 يوم",
  "31-60": "31-60 يوم",
  "61-90": "61-90 يوم",
  "91-180": "91-180 يوم",
  "180+": "أكثر من 180 يوم",
};

const STATUS_META: Record<AgingStatus, { label: string; className: string }> = {
  moving: {
    label: "متحرك",
    className: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  },
  slow: {
    label: "بطيء",
    className: "border-amber-300 text-amber-700 dark:text-amber-400",
  },
  dead: {
    label: "راكد",
    className: "border-red-300 text-red-600 dark:text-red-400",
  },
};

const num = (v: unknown) => Number(v ?? 0);
const fmtNum = (v: number) =>
  num(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (v: number) =>
  num(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function InventoryAgingPage() {
  const { formatCurrency, settings } = useSettings();

  const [asOf, setAsOf] = useState<string>(todayISO());
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AgingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [brand, setBrand] = useState("all");
  const [status, setStatus] = useState<"all" | AgingStatus>("all");
  const [bucket, setBucket] = useState<"all" | AgingBucket>("all");
  const [search, setSearch] = useState("");

  const load = async (date: string) => {
    setLoading(true);
    setError(null);
    const { data: res, error: err } = await (supabase.rpc as any)(
      "get_inventory_aging",
      {
        p_as_of: date,
        ...(settings?.inventory_slow_days
          ? { p_slow_days: settings.inventory_slow_days }
          : {}),
        ...(settings?.inventory_dead_days
          ? { p_dead_days: settings.inventory_dead_days }
          : {}),
      },
    );
    if (err) {
      setError(err.message);
      setData(null);
      notify.error("تعذر تحميل تقرير التعمير", err.message);
    } else {
      const parsed = res as AgingResult;
      setData({
        as_of: parsed?.as_of ?? date,
        slow_days: num(parsed?.slow_days),
        dead_days: num(parsed?.dead_days),
        rows: (parsed?.rows ?? []).map((r) => ({
          ...r,
          quantity: num(r.quantity),
          unit_cost: num(r.unit_cost),
          value: num(r.value),
          age_days: r.age_days === null ? null : num(r.age_days),
          days_since_sale: r.days_since_sale === null ? null : num(r.days_since_sale),
          selling_price: num(r.selling_price),
          nrv_margin: num(r.nrv_margin),
        })),
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    load(asOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asOf]);

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
        if (category !== "all" && (r.category_name ?? "") !== category) return false;
        if (brand !== "all" && (r.brand_name ?? "") !== brand) return false;
        if (status !== "all" && r.status !== status) return false;
        if (bucket !== "all" && r.bucket !== bucket) return false;
        return true;
      }),
    [rows, category, brand, status, bucket],
  );

  const totals = useMemo(() => {
    const acc = {
      value: 0,
      quantity: 0,
      slowValue: 0,
      slowCount: 0,
      deadValue: 0,
      deadCount: 0,
      over180Value: 0,
      over180Count: 0,
      nrvRiskValue: 0,
      nrvRiskCount: 0,
    };
    for (const r of filtered) {
      acc.value += r.value;
      acc.quantity += r.quantity;
      if (r.status === "slow") {
        acc.slowValue += r.value;
        acc.slowCount += 1;
      }
      if (r.status === "dead") {
        acc.deadValue += r.value;
        acc.deadCount += 1;
      }
      if (r.bucket === "180+") {
        acc.over180Value += r.value;
        acc.over180Count += 1;
      }
      if (r.nrv_margin <= 0) {
        acc.nrvRiskValue += r.value;
        acc.nrvRiskCount += 1;
      }
    }
    return acc;
  }, [filtered]);

  const bucketSummary = useMemo(
    () =>
      BUCKETS.map((b) => {
        const list = filtered.filter((r) => r.bucket === b);
        const value = list.reduce((s, r) => s + r.value, 0);
        return {
          bucket: b,
          count: list.length,
          value,
          pct: totals.value !== 0 ? (value / totals.value) * 100 : 0,
        };
      }),
    [filtered, totals.value],
  );

  const frozenPct =
    totals.value !== 0 ? ((totals.slowValue + totals.deadValue) / totals.value) * 100 : 0;

  const columns = useMemo<ColumnDef<AgingRow>[]>(
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
        accessorKey: "category_name",
        header: "الفئة",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.category_name || "—"}
          </span>
        ),
        meta: { hideOnMobile: true },
      },
      {
        accessorKey: "quantity",
        header: "الكمية",
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">{fmtQty(row.original.quantity)}</span>
        ),
      },
      {
        accessorKey: "value",
        header: "قيمة المخزون",
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums">{fmtNum(row.original.value)}</span>
        ),
      },
      {
        accessorKey: "bucket",
        header: "عمر آخر توريد",
        cell: ({ row }) => (
          <div className="text-sm">
            <div>{BUCKET_LABELS[row.original.bucket]}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.last_receipt_date || "لا يوجد توريد"}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "days_since_sale",
        header: "منذ آخر بيع",
        cell: ({ row }) => {
          const d = row.original.days_since_sale;
          return (
            <div className="text-sm">
              <div className="tabular-nums">
                {d === null ? "لم يُبع" : `${fmtQty(d)} يوم`}
              </div>
              <div className="text-xs text-muted-foreground">
                {row.original.last_sale_date || "—"}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "nrv_margin",
        header: "هامش البيع",
        cell: ({ row }) => (
          <span
            className={cn(
              "tabular-nums",
              row.original.nrv_margin <= 0 && "text-red-600 dark:text-red-400 font-medium",
            )}
          >
            {fmtNum(row.original.nrv_margin)}
          </span>
        ),
        meta: { hideOnMobile: true },
      },
      {
        accessorKey: "status",
        header: "الحالة",
        cell: ({ row }) => {
          const meta = STATUS_META[row.original.status];
          return (
            <Badge variant="outline" className={meta.className}>
              {meta.label}
            </Badge>
          );
        },
      },
    ],
    [],
  );

  const exportConfig = useMemo(
    () => ({
      filenamePrefix: "inventory-aging",
      sheetName: "تعمير المخزون",
      pdfTitle: `تعمير المخزون والأصناف الراكدة حتى ${asOf}`,
      headers: [
        "الكود",
        "الصنف",
        "الماركة",
        "رقم الموديل",
        "الفئة",
        "الكمية",
        "قيمة المخزون",
        "شريحة العمر",
        "منذ آخر بيع",
        "الحالة",
      ],
      rows: filtered.map((r) => [
        r.code,
        r.name,
        r.brand_name || "-",
        r.model_number || "-",
        r.category_name || "-",
        fmtQty(r.quantity),
        fmtNum(r.value),
        BUCKET_LABELS[r.bucket],
        r.days_since_sale === null ? "لم يُبع" : fmtQty(r.days_since_sale),
        STATUS_META[r.status].label,
      ]),
      settings,
      summaryCards: [
        { label: "قيمة المخزون", value: fmtNum(totals.value) },
        { label: "قيمة الأصناف البطيئة", value: fmtNum(totals.slowValue) },
        { label: "قيمة الأصناف الراكدة", value: fmtNum(totals.deadValue) },
        { label: "عدد الأصناف", value: String(filtered.length) },
      ],
      pdfOrientation: "landscape" as const,
    }),
    [filtered, settings, totals],
  );

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={Hourglass}
        title="تعمير المخزون والأصناف الراكدة"
        description={`شرائح عمر المخزون وحالة الحركة — حد البطيء ${data?.slow_days ?? 60} يوم، حد الركود ${data?.dead_days ?? 180} يوم`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => load(asOf)} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4 ml-2", loading && "animate-spin")} />
              تحديث
            </Button>
            <ExportMenu config={exportConfig} disabled={loading || filtered.length === 0} />
          </>
        }
      />

      <ReportPurposeBar
        what="توزيع أصناف المخزون على شرائح عمرية حسب آخر توريد، مع تصنيف حالة الحركة (متحرك / بطيء / راكد) حسب آخر بيع."
        decision="تحديد الأصناف المجمّدة للمال والتي تحتاج تخفيض سعر أو تصفية أو إيقاف شراء، وقياس نسبة رأس المال المحتجز."
        basis="عمر الصنف = الأيام من آخر عملية توريد. حالة الحركة = الأيام من آخر بيع مقارنة بحدود البطيء/الركود من إعدادات المخزون. القيمة بمتوسط التكلفة المرجح (WAC)."
        note="مؤشر NRV يقارن سعر البيع بالتكلفة لتحديد الأصناف المهددة بخسارة عند التصفية."
      />

      {/* شريط القاعدة المستخدمة */}

      <Card
        className={cn(
          "border-r-4 rounded-xl",
          frozenPct >= 30 ? "border-r-red-500" : frozenPct >= 15 ? "border-r-amber-500" : "border-r-emerald-500",
        )}
      >
        <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
          <div className="flex items-start gap-3">
            <Snowflake
              className={cn(
                "h-5 w-5 mt-0.5",
                frozenPct >= 30 ? "text-red-600" : frozenPct >= 15 ? "text-amber-600" : "text-emerald-600",
              )}
            />
            <div>
              <div className="font-semibold">
                رأس مال مجمّد: {formatCurrency(totals.slowValue + totals.deadValue)} (
                {frozenPct.toFixed(1)}% من قيمة المخزون)
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                القاعدة: صنف «بطيء» إذا مضى على آخر بيع {data?.slow_days ?? 60} يومًا أو أكثر،
                و«راكد» إذا مضى {data?.dead_days ?? 180} يومًا أو أكثر. الحدود قابلة للضبط من إعدادات المخزون.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <div className="text-xs text-muted-foreground">بطيء</div>
              <div className="font-bold tabular-nums text-amber-600">
                {totals.slowCount} صنف
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">راكد</div>
              <div className="font-bold tabular-nums text-red-600">{totals.deadCount} صنف</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">هامش سالب (مرشح للهبوط)</div>
              <div className="font-bold tabular-nums">{totals.nrvRiskCount} صنف</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* مؤشرات */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Coins}
          label="قيمة المخزون"
          value={formatCurrency(totals.value)}
          sub={`${filtered.length} صنف بكمية موجبة`}
          tone="primary"
        />
        <StatCard
          icon={TrendingDown}
          label="قيمة الأصناف البطيئة"
          value={formatCurrency(totals.slowValue)}
          sub={`${totals.slowCount} صنف`}
          tone="amber"
        />
        <StatCard
          icon={Snowflake}
          label="قيمة الأصناف الراكدة"
          value={formatCurrency(totals.deadValue)}
          sub={`${totals.deadCount} صنف`}
          tone={totals.deadValue > 0 ? "red" : "emerald"}
        />
        <StatCard
          icon={AlertTriangle}
          label="أقدم من 180 يوم"
          value={formatCurrency(totals.over180Value)}
          sub={`${totals.over180Count} صنف`}
          tone="purple"
        />
      </div>

      {/* شرائح العمر */}
      <Card className="rounded-xl">
        <CardContent className="p-3 space-y-2">
          <div className="font-semibold text-sm">توزيع قيمة المخزون على شرائح العمر</div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
            {bucketSummary.map((b) => (
              <Button
                key={b.bucket}
                type="button"
                variant="ghost"
                onClick={() => setBucket(bucket === b.bucket ? "all" : b.bucket)}
                className={cn(
                  "h-auto min-w-0 flex-col items-stretch gap-1.5 rounded-md px-2.5 py-2 text-right hover:bg-muted/60",
                  bucket === b.bucket && "bg-muted",
                )}
              >
                <div className="flex w-full min-w-0 items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium">{BUCKET_LABELS[b.bucket]}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">{b.pct.toFixed(1)}%</span>
                </div>
                <div className="flex w-full min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="shrink-0 tabular-nums">{b.count} صنف</span>
                  <span className="truncate tabular-nums">{fmtNum(b.value)}</span>
                </div>
                <div className="h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      b.bucket === "180+"
                        ? "bg-red-500"
                        : b.bucket === "91-180"
                          ? "bg-amber-500"
                          : "bg-primary",
                    )}
                    style={{ width: `${Math.min(100, b.pct)}%` }}
                  />
                </div>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* الجدول */}
      {error ? (
        <EmptyState
          icon={AlertTriangle}
          title="تعذر تحميل التقرير"
          description={error}
          action={<Button onClick={() => load(asOf)}>إعادة المحاولة</Button>}
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
          emptyMessage="لا توجد أصناف بكمية موجبة في هذا التاريخ"
          toolbarStart={
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-[150px]">
                <DatePickerInput value={asOf} onChange={(v) => setAsOf(v || todayISO())} />
              </div>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger className="w-[130px] h-9">
                  <SelectValue placeholder="الحالة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem>
                  <SelectItem value="moving">متحرك</SelectItem>
                  <SelectItem value="slow">بطيء</SelectItem>
                  <SelectItem value="dead">راكد</SelectItem>
                </SelectContent>
              </Select>
              <Select value={bucket} onValueChange={(v) => setBucket(v as typeof bucket)}>
                <SelectTrigger className="w-[150px] h-9">
                  <SelectValue placeholder="شريحة العمر" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الشرائح</SelectItem>
                  {BUCKETS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {BUCKET_LABELS[b]}
                    </SelectItem>
                  ))}
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
