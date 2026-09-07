import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import {
  PackagePlus,
  AlertTriangle,
  RefreshCw,
  ShoppingCart,
  Gauge,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
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

interface ReorderRow {
  product_id: string;
  code: string;
  name: string;
  model_number: string | null;
  brand_name: string | null;
  category_name: string | null;
  quantity: number;
  safety_stock: number;
  unit_cost: number;
  avg_daily_sales: number;
  period_sold: number;
  lead_time_days: number;
  target_cover_days: number;
  reorder_point: number;
  days_of_cover: number | null;
  suggested_qty: number;
  shortage_cost: number;
  last_supplier_id: string | null;
  last_supplier_name: string | null;
  last_purchase_date: string | null;
  last_purchase_price: number | null;

}

interface ReorderResult {
  date_from: string;
  date_to: string;
  period_days: number;
  lead_time_days: number;
  target_cover_days: number;
  rows: ReorderRow[];
}

type Urgency = "out" | "critical" | "watch";

const URGENCY_META: Record<Urgency, { label: string; className: string }> = {
  out: {
    label: "نافد",
    className: "border-red-300 text-red-600 dark:text-red-400",
  },
  critical: {
    label: "حرج",
    className: "border-amber-300 text-amber-700 dark:text-amber-400",
  },
  watch: {
    label: "للمراقبة",
    className: "border-sky-300 text-sky-700 dark:text-sky-400",
  },
};

const num = (v: unknown) => Number(v ?? 0);
const fmtNum = (v: number) =>
  num(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (v: number) =>
  num(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (d: number) =>
  new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

const urgencyOf = (r: ReorderRow): Urgency => {
  if (r.quantity <= 0) return "out";
  if (r.days_of_cover !== null && r.days_of_cover <= r.lead_time_days) return "critical";
  return "watch";
};

export default function InventoryReorderPage() {
  const { formatCurrency, settings } = useSettings();

  const [dateFrom, setDateFrom] = useState<string>(daysAgoISO(90));
  const [dateTo, setDateTo] = useState<string>(todayISO());
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReorderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [brand, setBrand] = useState("all");
  const [supplier, setSupplier] = useState("all");
  const [urgency, setUrgency] = useState<"all" | Urgency>("all");

  const [search, setSearch] = useState("");

  const load = async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    const { data: res, error: err } = await (supabase.rpc as any)(
      "get_inventory_reorder",
      {
        p_date_from: from,
        p_date_to: to,
        ...(settings?.inventory_lead_time_days
          ? { p_lead_time_days: settings.inventory_lead_time_days }
          : {}),
        ...(settings?.inventory_target_cover_days
          ? { p_target_days: settings.inventory_target_cover_days }
          : {}),
      },
    );
    if (err) {
      setError(err.message);
      setData(null);
      notify.error("تعذر تحميل تقرير إعادة الطلب", err.message);
    } else {
      const parsed = res as ReorderResult;
      setData({
        date_from: parsed?.date_from ?? from,
        date_to: parsed?.date_to ?? to,
        period_days: num(parsed?.period_days),
        lead_time_days: num(parsed?.lead_time_days),
        target_cover_days: num(parsed?.target_cover_days),
        rows: (parsed?.rows ?? []).map((r) => ({
          ...r,
          quantity: num(r.quantity),
          safety_stock: num(r.safety_stock),
          unit_cost: num(r.unit_cost),
          avg_daily_sales: num(r.avg_daily_sales),
          period_sold: num(r.period_sold),
          lead_time_days: num(r.lead_time_days),
          target_cover_days: num(r.target_cover_days),
          reorder_point: num(r.reorder_point),
          days_of_cover: r.days_of_cover === null ? null : num(r.days_of_cover),
          suggested_qty: num(r.suggested_qty),
          shortage_cost: num(r.shortage_cost),
          last_purchase_price:
            r.last_purchase_price === null || r.last_purchase_price === undefined
              ? null
              : num(r.last_purchase_price),

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
    () => Array.from(new Set(rows.map((r) => r.category_name).filter(Boolean))).sort() as string[],
    [rows],
  );
  const brands = useMemo(
    () => Array.from(new Set(rows.map((r) => r.brand_name).filter(Boolean))).sort() as string[],
    [rows],
  );
  const suppliers = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.last_supplier_name).filter(Boolean))).sort() as string[],
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (category !== "all" && (r.category_name ?? "") !== category) return false;
        if (brand !== "all" && (r.brand_name ?? "") !== brand) return false;
        if (supplier !== "all" && (r.last_supplier_name ?? "") !== supplier) return false;
        if (urgency !== "all" && urgencyOf(r) !== urgency) return false;
        return true;
      }),
    [rows, category, brand, supplier, urgency],
  );


  const totals = useMemo(() => {
    const acc = { cost: 0, qty: 0, out: 0, critical: 0, watch: 0, outCost: 0 };
    for (const r of filtered) {
      acc.cost += r.shortage_cost;
      acc.qty += r.suggested_qty;
      const u = urgencyOf(r);
      acc[u] += 1;
      if (u === "out") acc.outCost += r.avg_daily_sales * r.unit_cost * r.lead_time_days;
    }
    return acc;
  }, [filtered]);

  const columns = useMemo<ColumnDef<ReorderRow>[]>(
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
        accessorKey: "quantity",
        header: "المتاح",
        cell: ({ row }) => (
          <span
            className={cn(
              "font-medium tabular-nums",
              row.original.quantity <= 0 && "text-red-600 dark:text-red-400",
            )}
          >
            {fmtQty(row.original.quantity)}
          </span>
        ),
      },
      {
        accessorKey: "reorder_point",
        header: "نقطة إعادة الطلب",
        cell: ({ row }) => (
          <div className="text-sm">
            <div className="tabular-nums font-medium">{fmtQty(row.original.reorder_point)}</div>
            <div className="text-xs text-muted-foreground">
              أمان {fmtQty(row.original.safety_stock)}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "avg_daily_sales",
        header: "معدل البيع اليومي",
        cell: ({ row }) => (
          <div className="text-sm">
            <div className="tabular-nums">{fmtQty(row.original.avg_daily_sales)}</div>
            <div className="text-xs text-muted-foreground">
              بيع الفترة {fmtQty(row.original.period_sold)}
            </div>
          </div>
        ),
        meta: { hideOnMobile: true },
      },
      {
        accessorKey: "days_of_cover",
        header: "أيام التغطية",
        cell: ({ row }) => {
          const d = row.original.days_of_cover;
          const danger = d !== null && d <= row.original.lead_time_days;
          return (
            <span
              className={cn(
                "tabular-nums",
                danger && "text-red-600 dark:text-red-400 font-medium",
              )}
            >
              {d === null ? "—" : `${fmtQty(d)} يوم`}
            </span>
          );
        },
      },
      {
        accessorKey: "suggested_qty",
        header: "الكمية المقترحة",
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums">{fmtQty(row.original.suggested_qty)}</span>
        ),
      },
      {
        accessorKey: "shortage_cost",
        header: "تكلفة الطلب",
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums">{fmtNum(row.original.shortage_cost)}</span>
        ),
      },
      {
        id: "last_supplier",
        header: "آخر مورد",
        cell: ({ row }) => {
          const r = row.original;
          if (!r.last_supplier_name)
            return <span className="text-xs text-muted-foreground">لا توريد سابق</span>;
          return (
            <div className="min-w-[150px]">
              <div className="font-medium text-sm">{r.last_supplier_name}</div>
              <div className="text-xs text-muted-foreground">
                {[
                  r.last_purchase_date ?? null,
                  r.last_purchase_price === null ? null : `بسعر ${fmtNum(r.last_purchase_price)}`,
                ]
                  .filter(Boolean)
                  .join(" • ")}
              </div>
            </div>
          );
        },
        meta: { hideOnMobile: true },
      },


      {
        id: "urgency",
        header: "الأولوية",
        cell: ({ row }) => {
          const meta = URGENCY_META[urgencyOf(row.original)];
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
      filenamePrefix: "inventory-reorder",
      sheetName: "إعادة الطلب",
      pdfTitle: `أصناف تحت نقطة إعادة الطلب (${dateFrom} — ${dateTo})`,
      headers: [
        "الكود",
        "الصنف",
        "الماركة",
        "رقم الموديل",
        "الفئة",
        "المتاح",
        "نقطة إعادة الطلب",
        "معدل البيع اليومي",
        "أيام التغطية",
        "الكمية المقترحة",
        "تكلفة الطلب",
        "آخر مورد",
        "تاريخ آخر توريد",
        "آخر سعر شراء",
        "الأولوية",
      ],
      rows: filtered.map((r) => [
        r.code,
        r.name,
        r.brand_name || "-",
        r.model_number || "-",
        r.category_name || "-",
        fmtQty(r.quantity),
        fmtQty(r.reorder_point),
        fmtQty(r.avg_daily_sales),
        r.days_of_cover === null ? "-" : fmtQty(r.days_of_cover),
        fmtQty(r.suggested_qty),
        fmtNum(r.shortage_cost),
        r.last_supplier_name || "-",
        r.last_purchase_date || "-",
        r.last_purchase_price === null ? "-" : fmtNum(r.last_purchase_price),
        URGENCY_META[urgencyOf(r)].label,
      ]),

      settings,
      summaryCards: [
        { label: "عدد الأصناف", value: String(filtered.length) },
        { label: "الكمية المقترحة", value: fmtQty(totals.qty) },
        { label: "تكلفة الطلب", value: fmtNum(totals.cost) },
        { label: "أصناف نافدة", value: String(totals.out) },
      ],
      pdfOrientation: "landscape" as const,
    }),
    [filtered, settings, totals, dateFrom, dateTo],
  );

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={PackagePlus}
        title="إعادة الطلب والنواقص"
        description={`الأصناف التي وصلت أو نزلت عن نقطة إعادة الطلب — مهلة التوريد ${data?.lead_time_days ?? 7} يوم، تغطية مستهدفة ${data?.target_cover_days ?? 30} يوم`}
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
        what="قائمة الأصناف التي وصلت أو نزلت عن نقطة إعادة الطلب، مع الكمية المقترحة وتكلفتها وآخر مورد وردها."
        decision="ماذا نشتري، بأي كمية، ومن أي مورد — لإصدار أوامر الشراء وتجنّب النفاد."
        basis="معدل البيع اليومي من صافي حركات البيع خلال الفترة × مهلة التوريد + مخزون الأمان، والتكلفة بالمتوسط المرجح (WAC)."
        note="مهلة التوريد وأيام التغطية المستهدفة تُضبط من: الإعدادات ← إعدادات المخزون. البحث يشمل الكود والاسم والماركة ورقم موديل المصنع واسم المورد."
      />


      {/* شريط القرار */}
      <Card
        className={cn(
          "border-r-4 rounded-xl",
          totals.out > 0
            ? "border-r-red-500"
            : totals.critical > 0
              ? "border-r-amber-500"
              : "border-r-emerald-500",
        )}
      >
        <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
          <div className="flex items-start gap-3">
            <ShoppingCart
              className={cn(
                "h-5 w-5 mt-0.5",
                totals.out > 0
                  ? "text-red-600"
                  : totals.critical > 0
                    ? "text-amber-600"
                    : "text-emerald-600",
              )}
            />
            <div>
              <div className="font-semibold">
                أمر شراء مقترح: {fmtQty(totals.qty)} وحدة بتكلفة{" "}
                {formatCurrency(totals.cost)} لتغطية {data?.target_cover_days ?? 30} يومًا
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                القاعدة: نقطة إعادة الطلب = (معدل البيع اليومي × مهلة التوريد{" "}
                {data?.lead_time_days ?? 7} يوم) + مخزون الأمان. الكمية المقترحة = (معدل البيع ×
                أيام التغطية) + مخزون الأمان − المتاح. معدل البيع محسوب من صافي البيع خلال{" "}
                {data?.period_days ?? 91} يومًا. الحدود قابلة للضبط من إعدادات المخزون.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <div className="text-xs text-muted-foreground">نافد</div>
              <div className="font-bold tabular-nums text-red-600">{totals.out} صنف</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">حرج</div>
              <div className="font-bold tabular-nums text-amber-600">{totals.critical} صنف</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">للمراقبة</div>
              <div className="font-bold tabular-nums">{totals.watch} صنف</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Gauge className="h-3 w-3" /> بيع مفقود محتمل (النافد)
              </div>
              <div className="font-bold tabular-nums">{fmtNum(totals.outCost)}</div>
            </div>
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
          searchPlaceholder="بحث بالكود أو الاسم أو الماركة أو رقم الموديل أو المورد..."
          pageSize={25}
          compactRows
          emptyMessage="لا توجد أصناف تحت نقطة إعادة الطلب في هذه الفترة"
          toolbarStart={
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-[150px]">
                <DatePickerInput
                  value={dateFrom}
                  onChange={(v) => setDateFrom(v || daysAgoISO(90))}
                />
              </div>
              <div className="w-[150px]">
                <DatePickerInput value={dateTo} onChange={(v) => setDateTo(v || todayISO())} />
              </div>
              <Select value={urgency} onValueChange={(v) => setUrgency(v as typeof urgency)}>
                <SelectTrigger className="w-[130px] h-9">
                  <SelectValue placeholder="الأولوية" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الأولويات</SelectItem>
                  <SelectItem value="out">نافد</SelectItem>
                  <SelectItem value="critical">حرج</SelectItem>
                  <SelectItem value="watch">للمراقبة</SelectItem>
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
              <SearchableSelect
                value={supplier}
                onChange={setSupplier}
                options={suppliers}
                allLabel="كل الموردين"
                searchPlaceholder="بحث في الموردين..."
                className="w-[150px]"
              />
            </div>

          }
        />
      )}
    </div>
  );
}
