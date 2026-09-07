import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ColumnDef } from "@tanstack/react-table";
import {
  Boxes,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Scale,
  Layers,
  Package,
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
import { SearchableSelect } from "@/components/shared/SearchableSelect";

import { ReportPurposeBar } from "@/components/shared/ReportPurposeBar";
import { productReportFilterFn } from "@/lib/report-filters";
import { supabase } from "@/integrations/supabase/client";

import { useSettings } from "@/contexts/SettingsContext";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────

interface ValuationRow {
  product_id: string;
  code: string;
  name: string;
  model_number: string | null;
  brand_name: string | null;
  category_name: string | null;
  is_active: boolean;
  quantity: number;
  unit_cost: number;
  value: number;
  moves_value: number;
  last_supplier_name: string | null;
  last_purchase_date: string | null;
  last_purchase_price: number | null;
}


interface ValuationResult {
  as_of: string;
  gl_balance: number;
  total_value: number;
  total_moves_value: number;
  total_quantity: number;
  rows: ValuationRow[];
}

const num = (v: unknown) => Number(v ?? 0);
const fmtNum = (v: number) =>
  num(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (v: number) =>
  num(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function InventoryValuationPage() {
  const { formatCurrency, settings } = useSettings();

  const [asOf, setAsOf] = useState<string>(todayISO());
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ValuationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [brand, setBrand] = useState("all");
  const [supplier, setSupplier] = useState("all");

  const [search, setSearch] = useState("");

  const load = async (date: string) => {
    setLoading(true);
    setError(null);
    const { data: res, error: err } = await (supabase.rpc as any)(
      "get_inventory_valuation",
      { p_as_of: date },
    );
    if (err) {
      setError(err.message);
      setData(null);
      notify.error("تعذر تحميل تقييم المخزون", err.message);
    } else {
      const parsed = res as ValuationResult;
      setData({
        as_of: parsed?.as_of ?? date,
        gl_balance: num(parsed?.gl_balance),
        total_value: num(parsed?.total_value),
        total_moves_value: num(parsed?.total_moves_value),
        total_quantity: num(parsed?.total_quantity),
        rows: (parsed?.rows ?? []).map((r) => ({
          ...r,
          quantity: num(r.quantity),
          unit_cost: num(r.unit_cost),
          value: num(r.value),
          moves_value: num(r.moves_value),
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
    load(asOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asOf]);

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
        return true;
      }),
    [rows, category, brand, supplier],
  );


  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, r) => {
          acc.value += r.value;
          acc.quantity += r.quantity;
          if (r.quantity < 0) acc.negative += 1;
          if (r.quantity === 0 && r.moves_value !== 0) acc.zeroWithValue += 1;
          return acc;
        },
        { value: 0, quantity: 0, negative: 0, zeroWithValue: 0 },
      ),
    [filtered],
  );

  const glBalance = num(data?.gl_balance);
  const variance = +(num(data?.total_value) - glBalance).toFixed(2);
  const matched = Math.abs(variance) < 0.01;
  const variancePct = glBalance !== 0 ? (variance / glBalance) * 100 : 0;

  const columns = useMemo<ColumnDef<ValuationRow>[]>(
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
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="min-w-[180px]">
              <div className="font-medium">{r.name}</div>
              <div className="text-xs text-muted-foreground">
                {[r.brand_name, r.model_number].filter(Boolean).join(" • ") || "—"}
              </div>
            </div>
          );
        },
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
          <span
            className={cn(
              "font-medium tabular-nums",
              row.original.quantity < 0 && "text-red-600 dark:text-red-400",
            )}
          >
            {fmtQty(row.original.quantity)}
          </span>
        ),
      },
      {
        accessorKey: "unit_cost",
        header: "متوسط التكلفة",
        cell: ({ row }) => (
          <span className="tabular-nums">{fmtNum(row.original.unit_cost)}</span>
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
        id: "share",
        header: "الوزن %",
        cell: ({ row }) => {
          const pct = totals.value !== 0 ? (row.original.value / totals.value) * 100 : 0;
          return (
            <span className="text-xs text-muted-foreground tabular-nums">
              {pct.toFixed(1)}%
            </span>
          );
        },
        meta: { hideOnMobile: true },
      },
      {
        id: "status",
        header: "الحالة",
        cell: ({ row }) => {
          const r = row.original;
          if (r.quantity < 0)
            return (
              <Badge variant="outline" className="border-red-300 text-red-600 dark:text-red-400">
                كمية سالبة
              </Badge>
            );
          if (r.quantity === 0)
            return (
              <Badge variant="outline" className="text-muted-foreground">
                نافد
              </Badge>
            );
          if (!r.is_active)
            return (
              <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-400">
                موقوف
              </Badge>
            );
          return (
            <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-400">
              سليم
            </Badge>
          );
        },
      },
    ],
    [totals.value],
  );

  const exportConfig = useMemo(
    () => ({
      filenamePrefix: "inventory-valuation",
      sheetName: "تقييم المخزون",
      pdfTitle: `تقييم المخزون حتى ${asOf}`,
      headers: [
        "الكود",
        "الصنف",
        "الماركة",
        "رقم الموديل",
        "الفئة",
        "الكمية",
        "متوسط التكلفة",
        "قيمة المخزون",
        "آخر مورد",
        "تاريخ آخر توريد",
        "آخر سعر شراء",
      ],
      rows: filtered.map((r) => [
        r.code,
        r.name,
        r.brand_name || "-",
        r.model_number || "-",
        r.category_name || "-",
        fmtQty(r.quantity),
        fmtNum(r.unit_cost),
        fmtNum(r.value),
        r.last_supplier_name || "-",
        r.last_purchase_date || "-",
        r.last_purchase_price === null ? "-" : fmtNum(r.last_purchase_price),
      ]),

      settings,
      summaryCards: [
        { label: "قيمة المخزون (WAC)", value: fmtNum(totals.value) },
        { label: "رصيد حساب المخزون 1104", value: fmtNum(glBalance) },
        { label: "الفرق", value: fmtNum(variance) },
        { label: "عدد الأصناف", value: String(filtered.length) },
      ],
      pdfOrientation: "landscape" as const,
    }),
    [filtered, settings, totals.value, glBalance, variance, asOf],
  );

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={Boxes}
        title="تقييم المخزون"
        description="قيمة المخزون بمتوسط التكلفة المرجح (WAC) ومطابقتها مع حساب المخزون 1104"
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
        what="قيمة المخزون لكل صنف بالكمية ومتوسط التكلفة حتى تاريخ محدد، مع شريط مطابقة مقابل حساب المخزون 1104."
        decision="التأكد من صحة أرقام المخزون المحاسبية قبل إغلاق الفترة، وتحديد الأصناف ذات الأرصدة الشاذة (سالبة أو صفرية بقيمة)."
        basis="متوسط التكلفة المرجح (WAC) محسوب من حركات المخزون الفعلية حتى تاريخ التقييم، ومقارنته برصيد 1104 في القيود المرحلة."
        note="التصدير يشمل آخر مورد وتاريخ وسعر آخر توريد لكل صنف. البحث يشمل الكود والاسم والماركة ورقم موديل المصنع والمورد."
      />


      {/* شريط المطابقة مع الدفاتر */}
      <Card
        className={cn(
          "border-r-4 rounded-xl",
          matched ? "border-r-emerald-500" : "border-r-amber-500",
        )}
      >
        <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
          <div className="flex items-start gap-3">
            {matched ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
            )}
            <div>
              <div className="font-semibold">
                {matched
                  ? "المخزون مطابق لحساب 1104"
                  : "يوجد فرق بين قيمة المخزون وحساب 1104"}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {matched
                  ? "قيمة الأصناف تساوي رصيد الحساب الدفتري — لا يوجد إجراء مطلوب."
                  : "الفرق يعني قيود مخزون بدون حركة مقابلة أو حركة بدون قيد. راجع تسوية المخزون لتحديد الأصناف."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <div className="text-xs text-muted-foreground">قيمة الأصناف (WAC)</div>
              <div className="font-bold tabular-nums">{formatCurrency(num(data?.total_value))}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">حساب 1104</div>
              <div className="font-bold tabular-nums">{formatCurrency(glBalance)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">الفرق</div>
              <div
                className={cn(
                  "font-bold tabular-nums",
                  matched ? "text-emerald-600" : "text-amber-600",
                )}
              >
                {formatCurrency(variance)}
                {!matched && glBalance !== 0 && (
                  <span className="text-xs font-normal text-muted-foreground mr-1">
                    ({variancePct.toFixed(2)}%)
                  </span>
                )}
              </div>
            </div>
            {!matched && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/reports/inventory-reconciliation">فتح التسوية</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* مؤشرات */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Scale}
          label="قيمة المخزون"
          value={formatCurrency(totals.value)}
          sub={`حتى ${asOf}`}
          tone="primary"
        />
        <StatCard
          icon={Package}
          label="إجمالي الكميات"
          value={fmtQty(totals.quantity)}
          sub={`${filtered.length} صنف`}
          tone="blue"
        />
        <StatCard
          icon={Layers}
          label="متوسط تكلفة الوحدة"
          value={fmtNum(totals.quantity !== 0 ? totals.value / totals.quantity : 0)}
          sub="قيمة ÷ كمية"
          tone="purple"
        />
        <StatCard
          icon={AlertTriangle}
          label="أصناف تحتاج مراجعة"
          value={String(totals.negative + totals.zeroWithValue)}
          sub={`${totals.negative} كمية سالبة • ${totals.zeroWithValue} قيمة بدون كمية`}
          tone={totals.negative + totals.zeroWithValue > 0 ? "amber" : "emerald"}
        />
      </div>

      {/* الفلاتر والجدول */}
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
          searchPlaceholder="بحث بالكود أو الاسم أو الماركة أو رقم الموديل أو المورد..."
          pageSize={25}
          compactRows
          emptyMessage="لا توجد أصناف بقيمة أو حركة في هذا التاريخ"
          toolbarStart={
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-[150px]">
                <DatePickerInput value={asOf} onChange={(v) => setAsOf(v || todayISO())} />
              </div>
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
