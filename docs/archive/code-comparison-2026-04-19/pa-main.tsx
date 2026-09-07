import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { DatePickerInput } from "@/components/DatePickerInput";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format, startOfMonth, endOfMonth } from "date-fns";
import {
  FileSpreadsheet,
  FileText,
  Trophy,
  TrendingUp,
  DollarSign,
  Package,
  Medal,
  AlertTriangle,
  Info,
  ShoppingCart,
} from "lucide-react";
import { CategoryTreeSelect } from "@/components/CategoryTreeSelect";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { exportToExcel } from "@/lib/excel-export";
import { exportReportPdf } from "@/lib/report-pdf";
import { useSettings } from "@/contexts/SettingsContext";

const CHART_COLORS = [
  "hsl(24, 95%, 53%)",
  "hsl(152, 60%, 42%)",
  "hsl(217, 80%, 50%)",
  "hsl(340, 65%, 50%)",
  "hsl(262, 60%, 50%)",
  "hsl(38, 92%, 50%)",
  "hsl(0, 72%, 51%)",
  "hsl(190, 70%, 45%)",
];

const TURNOVER_COLORS = {
  excellent: "hsl(152, 60%, 42%)",
  medium: "hsl(38, 92%, 50%)",
  slow: "hsl(0, 72%, 51%)",
  dead: "hsl(0, 50%, 30%)",
};

type ViewType = "top-sellers" | "most-profitable" | "by-category" | "turnover";

interface ProductMetrics {
  name: string;
  code: string;
  category: string;
  categoryId: string | null;
  soldQty: number;
  returnedQty: number;
  netQty: number;
  revenue: number;
  returnsValue: number;
  netRevenue: number;
  cogs: number;
  returnsCogs: number;
  netCogs: number;
  profit: number;
  currentStock: number;
  minStockLevel: number;
  purchasePrice: number;
}

interface CategoryMetrics {
  name: string;
  productCount: number;
  netQty: number;
  netRevenue: number;
  netCogs: number;
  profit: number;
}

type TurnoverRating = "excellent" | "medium" | "slow" | "dead";

interface TurnoverMetrics {
  name: string;
  code: string;
  category: string;
  cogs: number;
  avgInventory: number;
  turnover: number;
  currentStock: number;
  minStockLevel: number;
  rating: TurnoverRating;
}

export default function ProductAnalytics() {
  const { settings } = useSettings();
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));
  const [view, setView] = useState<ViewType>("top-sellers");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Query 1: Sales invoice items
  const { data: salesItems, isLoading: loadingSales } = useQuery({
    queryKey: ["pa-sales", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoice_items")
        .select(
          "quantity, total, net_total, unit_price, product_id, product:products(name, code, category_id, quantity_on_hand, min_stock_level, purchase_price, category:product_categories(name)), invoice:sales_invoices!inner(invoice_date, status)",
        )
        .gte("invoice.invoice_date", dateFrom)
        .lte("invoice.invoice_date", dateTo)
        .eq("invoice.status", "posted");
      if (error) throw error;
      return data;
    },
  });

  // Query 2: Sales return items
  const { data: returnItems, isLoading: loadingReturns } = useQuery({
    queryKey: ["pa-returns", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_return_items")
        .select("quantity, total, product_id, return:sales_returns!inner(return_date, status)")
        .gte("return.return_date", dateFrom)
        .lte("return.return_date", dateTo)
        .eq("return.status", "posted");
      if (error) throw error;
      return data;
    },
  });

  // Query 3: Inventory movements for actual COGS
  const { data: movements, isLoading: loadingMovements } = useQuery({
    queryKey: ["pa-movements", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("product_id, movement_type, quantity, total_cost, movement_date")
        .in("movement_type", ["sale", "sale_return"])
        .gte("movement_date", dateFrom)
        .lte("movement_date", dateTo);
      if (error) throw error;
      return data;
    },
  });

  // Query 4: All active products
  const { data: products, isLoading: loadingProducts } = useQuery({
    queryKey: ["pa-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, name, code, purchase_price, selling_price, quantity_on_hand, min_stock_level, category_id, category:product_categories(name)",
        )
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  // Query 5: Categories for filter
  const { data: categories } = useQuery({
    queryKey: ["pa-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_categories")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const isLoading = loadingSales || loadingReturns || loadingMovements || loadingProducts;

  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtN = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  // Build product metrics
  const productMetrics = useMemo(() => {
    const metrics: Record<string, ProductMetrics> = {};

    salesItems?.forEach((item: any) => {
      const id = item.product_id || "unknown";
      if (!metrics[id]) {
        metrics[id] = {
          name: item.product?.name || "محذوف",
          code: item.product?.code || "-",
          category: item.product?.category?.name || "بدون تصنيف",
          categoryId: item.product?.category_id || null,
          soldQty: 0,
          returnedQty: 0,
          netQty: 0,
          revenue: 0,
          returnsValue: 0,
          netRevenue: 0,
          cogs: 0,
          returnsCogs: 0,
          netCogs: 0,
          profit: 0,
          currentStock: Number(item.product?.quantity_on_hand || 0),
          minStockLevel: Number(item.product?.min_stock_level || 0),
          purchasePrice: Number(item.product?.purchase_price || 0),
        };
      }
      metrics[id].soldQty += Number(item.quantity);
      metrics[id].revenue += Number(item.net_total || item.total);
    });

    returnItems?.forEach((item: any) => {
      const id = item.product_id || "unknown";
      if (!metrics[id]) {
        metrics[id] = {
          name: "محذوف",
          code: "-",
          category: "بدون تصنيف",
          categoryId: null,
          soldQty: 0,
          returnedQty: 0,
          netQty: 0,
          revenue: 0,
          returnsValue: 0,
          netRevenue: 0,
          cogs: 0,
          returnsCogs: 0,
          netCogs: 0,
          profit: 0,
          currentStock: 0,
          minStockLevel: 0,
          purchasePrice: 0,
        };
      }
      metrics[id].returnedQty += Number(item.quantity);
      metrics[id].returnsValue += Number(item.total);
    });

    movements?.forEach((m: any) => {
      const id = m.product_id;
      if (!metrics[id]) return;
      if (m.movement_type === "sale") {
        metrics[id].cogs += Number(m.total_cost);
      } else if (m.movement_type === "sale_return") {
        metrics[id].returnsCogs += Number(m.total_cost);
      }
    });

    Object.values(metrics).forEach((p) => {
      p.netQty = p.soldQty - p.returnedQty;
      p.netRevenue = p.revenue - p.returnsValue;
      p.netCogs = p.cogs - p.returnsCogs;
      p.profit = p.netRevenue - p.netCogs;
    });

    return metrics;
  }, [salesItems, returnItems, movements]);

  const filteredMetrics = useMemo(() => {
    const all = Object.values(productMetrics);
    if (categoryFilter === "all") return all;
    return all.filter((p) => p.categoryId === categoryFilter);
  }, [productMetrics, categoryFilter]);

  const kpis = useMemo(() => {
    const distinctProducts = filteredMetrics.filter((p) => p.soldQty > 0).length;
    const totalNetQty = filteredMetrics.reduce((s, p) => s + p.netQty, 0);
    const totalNetRevenue = filteredMetrics.reduce((s, p) => s + p.netRevenue, 0);
    const totalProfit = filteredMetrics.reduce((s, p) => s + p.profit, 0);
    return { distinctProducts, totalNetQty, totalNetRevenue, totalProfit };
  }, [filteredMetrics]);

  const topSellers = useMemo(() => [...filteredMetrics].sort((a, b) => b.netQty - a.netQty), [filteredMetrics]);
  const mostProfitable = useMemo(() => [...filteredMetrics].sort((a, b) => b.profit - a.profit), [filteredMetrics]);

  const categoryList = useMemo(() => {
    const cats: Record<
      string,
      { name: string; productCount: number; netQty: number; netRevenue: number; netCogs: number; profit: number }
    > = {};
    filteredMetrics.forEach((p) => {
      if (!cats[p.category])
        cats[p.category] = { name: p.category, productCount: 0, netQty: 0, netRevenue: 0, netCogs: 0, profit: 0 };
      cats[p.category].productCount++;
      cats[p.category].netQty += p.netQty;
      cats[p.category].netRevenue += p.netRevenue;
      cats[p.category].netCogs += p.netCogs;
      cats[p.category].profit += p.profit;
    });
    return Object.values(cats).sort((a, b) => b.netRevenue - a.netRevenue);
  }, [filteredMetrics]);

  const turnoverData = useMemo(() => {
    const allProducts = products || [];
    const filtered =
      categoryFilter === "all" ? allProducts : allProducts.filter((p: any) => p.category_id === categoryFilter);
    return filtered
      .map((p: any) => {
        const m = productMetrics[p.id];
        const cogs = m?.netCogs || 0;
        const currentStockValue = Number(p.quantity_on_hand) * Number(p.purchase_price);
        const avgInventory = currentStockValue > 0 ? currentStockValue : 1;
        const turnover = cogs > 0 ? Math.round((cogs / avgInventory) * 100) / 100 : 0;
        const hasSales = m && m.soldQty > 0;
        return {
          name: p.name,
          code: p.code,
          category: p.category?.name || "بدون تصنيف",
          cogs,
          avgInventory: currentStockValue,
          turnover,
          currentStock: Number(p.quantity_on_hand),
          minStockLevel: Number(p.min_stock_level),
          rating: !hasSales
            ? ("dead" as const)
            : turnover > 2
              ? ("excellent" as const)
              : turnover > 0.5
                ? ("medium" as const)
                : ("slow" as const),
        };
      })
      .sort((a, b) => b.turnover - a.turnover);
  }, [products, productMetrics, categoryFilter]);

  const deadStockCount = turnoverData.filter((p) => p.rating === "dead" && p.currentStock > 0).length;
  const deadStockValue = turnoverData
    .filter((p) => p.rating === "dead" && p.currentStock > 0)
    .reduce((s, p) => s + p.avgInventory, 0);
  const reorderAlerts = turnoverData.filter(
    (p) => p.currentStock > 0 && p.currentStock < p.minStockLevel && p.rating !== "dead",
  );

  const turnoverDistribution = useMemo(() => {
    const dist = { excellent: 0, medium: 0, slow: 0, dead: 0 };
    turnoverData.forEach((p) => {
      dist[p.rating]++;
    });
    return [
      { name: "ممتاز (>2)", value: dist.excellent, color: TURNOVER_COLORS.excellent },
      { name: "متوسط (0.5-2)", value: dist.medium, color: TURNOVER_COLORS.medium },
      { name: "بطيء (≤0.5)", value: dist.slow, color: TURNOVER_COLORS.slow },
      { name: "راكد (0)", value: dist.dead, color: TURNOVER_COLORS.dead },
    ].filter((d) => d.value > 0);
  }, [turnoverData]);

  const chartData = useMemo(() => {
    if (view === "top-sellers")
      return topSellers
        .slice(0, 10)
        .map((p) => ({ name: p.name.length > 15 ? p.name.slice(0, 15) + "..." : p.name, value: p.netQty }));
    if (view === "most-profitable")
      return mostProfitable
        .slice(0, 10)
        .map((p) => ({ name: p.name.length > 15 ? p.name.slice(0, 15) + "..." : p.name, value: p.profit }));
    return [];
  }, [view, topSellers, mostProfitable]);

  const categoryChartData = useMemo(
    () =>
      categoryList.map((c, i) => ({ name: c.name, value: c.netRevenue, color: CHART_COLORS[i % CHART_COLORS.length] })),
    [categoryList],
  );

  // ─── Design-only helpers ──────────────────────────────────────────────────
  const medalIcon = (index: number) => {
    if (index === 0) return <Medal className="w-4 h-4 text-yellow-500 drop-shadow-sm" />;
    if (index === 1) return <Medal className="w-4 h-4 text-slate-400 drop-shadow-sm" />;
    if (index === 2) return <Medal className="w-4 h-4 text-amber-700 drop-shadow-sm" />;
    return <span className="text-muted-foreground/60 text-xs font-medium tabular-nums">{index + 1}</span>;
  };

  const profitColor = (val: number) =>
    val >= 0
      ? "text-emerald-600 dark:text-emerald-400 font-bold tabular-nums"
      : "text-destructive font-bold tabular-nums";

  // ─── Column Definitions for DataTable ─────────────────────────────────────

  const topSellersColumns = useMemo<ColumnDef<ProductMetrics>[]>(() => [
    {
      id: "rank",
      header: "#",
      cell: ({ row }) => medalIcon(row.index),
      size: 50,
      enableSorting: false,
    },
    {
      accessorKey: "code",
      header: "الكود",
      cell: ({ getValue }) => <span className="text-muted-foreground text-xs font-mono">{getValue() as string}</span>,
    },
    {
      accessorKey: "name",
      header: "المنتج",
      cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
    },
    {
      accessorKey: "category",
      header: "التصنيف",
      cell: ({ getValue }) => <Badge variant="secondary" className="text-xs font-normal">{getValue() as string}</Badge>,
    },
    {
      accessorKey: "soldQty",
      header: "مباع",
      cell: ({ getValue }) => <span className="tabular-nums">{fmtN(getValue() as number)}</span>,
      footer: () => <span className="tabular-nums font-bold">{fmtN(topSellers.reduce((s, p) => s + p.soldQty, 0))}</span>,
    },
    {
      accessorKey: "returnedQty",
      header: "مرتجع",
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return v > 0 ? <span className="tabular-nums text-destructive/80">{fmtN(v)}</span> : <span className="text-muted-foreground/40">—</span>;
      },
      footer: () => <span className="tabular-nums font-bold text-destructive/80">{fmtN(topSellers.reduce((s, p) => s + p.returnedQty, 0))}</span>,
    },
    {
      accessorKey: "netQty",
      header: "صافي",
      cell: ({ getValue }) => <span className="font-semibold tabular-nums">{fmtN(getValue() as number)}</span>,
      footer: () => <span className="tabular-nums font-bold">{fmtN(topSellers.reduce((s, p) => s + p.netQty, 0))}</span>,
    },
    {
      accessorKey: "netRevenue",
      header: "الإيرادات",
      cell: ({ getValue }) => <span className="tabular-nums">{fmt(getValue() as number)}</span>,
      footer: () => <span className="tabular-nums font-bold">{fmt(topSellers.reduce((s, p) => s + p.netRevenue, 0))}</span>,
    },
    {
      accessorKey: "netCogs",
      header: "التكلفة",
      cell: ({ getValue }) => <span className="tabular-nums text-muted-foreground">{fmt(getValue() as number)}</span>,
      footer: () => <span className="tabular-nums font-bold text-muted-foreground">{fmt(topSellers.reduce((s, p) => s + p.netCogs, 0))}</span>,
    },
    {
      accessorKey: "profit",
      header: "الربح",
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return <span className={profitColor(v)}>{fmt(v)}</span>;
      },
      footer: () => {
        const total = topSellers.reduce((s, p) => s + p.profit, 0);
        return <span className={profitColor(total)}>{fmt(total)}</span>;
      },
    },
  ], [topSellers, fmt, fmtN, profitColor, medalIcon]);

  const mostProfitableColumns = useMemo<ColumnDef<ProductMetrics>[]>(() => [
    {
      id: "rank",
      header: "#",
      cell: ({ row }) => medalIcon(row.index),
      size: 50,
      enableSorting: false,
    },
    {
      accessorKey: "code",
      header: "الكود",
      cell: ({ getValue }) => <span className="text-muted-foreground text-xs font-mono">{getValue() as string}</span>,
    },
    {
      accessorKey: "name",
      header: "المنتج",
      cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
    },
    {
      accessorKey: "category",
      header: "التصنيف",
      cell: ({ getValue }) => <Badge variant="secondary" className="text-xs font-normal">{getValue() as string}</Badge>,
    },
    {
      accessorKey: "netRevenue",
      header: "صافي الإيرادات",
      cell: ({ getValue }) => <span className="tabular-nums">{fmt(getValue() as number)}</span>,
      footer: () => <span className="tabular-nums font-bold">{fmt(mostProfitable.reduce((s, p) => s + p.netRevenue, 0))}</span>,
    },
    {
      accessorKey: "netCogs",
      header: "التكلفة",
      cell: ({ getValue }) => <span className="tabular-nums text-muted-foreground">{fmt(getValue() as number)}</span>,
      footer: () => <span className="tabular-nums font-bold text-muted-foreground">{fmt(mostProfitable.reduce((s, p) => s + p.netCogs, 0))}</span>,
    },
    {
      accessorKey: "profit",
      header: "الربح",
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return <span className={profitColor(v)}>{fmt(v)}</span>;
      },
      footer: () => {
        const total = mostProfitable.reduce((s, p) => s + p.profit, 0);
        return <span className={profitColor(total)}>{fmt(total)}</span>;
      },
    },
    {
      id: "margin",
      header: "هامش الربح",
      accessorFn: (row) => row.netRevenue > 0 ? (row.profit / row.netRevenue) * 100 : 0,
      cell: ({ getValue }) => {
        const margin = getValue() as number;
        return (
          <Badge variant={margin > 30 ? "default" : margin > 15 ? "secondary" : "destructive"} className="tabular-nums text-xs">
            {margin.toFixed(1)}%
          </Badge>
        );
      },
    },
  ], [mostProfitable, fmt, profitColor, medalIcon]);

  const categoryColumns = useMemo<ColumnDef<CategoryMetrics>[]>(() => [
    {
      accessorKey: "name",
      header: "التصنيف",
      cell: ({ getValue }) => <span className="font-semibold">{getValue() as string}</span>,
      footer: () => <span className="font-bold">الإجمالي</span>,
    },
    {
      accessorKey: "productCount",
      header: "عدد المنتجات",
      cell: ({ getValue }) => <span className="tabular-nums">{getValue() as number}</span>,
      footer: () => <span className="tabular-nums font-bold">{categoryList.reduce((s, c) => s + c.productCount, 0)}</span>,
    },
    {
      accessorKey: "netQty",
      header: "صافي الكمية",
      cell: ({ getValue }) => <span className="tabular-nums">{fmtN(getValue() as number)}</span>,
      footer: () => <span className="tabular-nums font-bold">{fmtN(categoryList.reduce((s, c) => s + c.netQty, 0))}</span>,
    },
    {
      accessorKey: "netRevenue",
      header: "صافي الإيرادات",
      cell: ({ getValue }) => <span className="tabular-nums">{fmt(getValue() as number)}</span>,
      footer: () => <span className="tabular-nums font-bold">{fmt(categoryList.reduce((s, c) => s + c.netRevenue, 0))}</span>,
    },
    {
      accessorKey: "netCogs",
      header: "التكلفة",
      cell: ({ getValue }) => <span className="tabular-nums text-muted-foreground">{fmt(getValue() as number)}</span>,
      footer: () => <span className="tabular-nums font-bold text-muted-foreground">{fmt(categoryList.reduce((s, c) => s + c.netCogs, 0))}</span>,
    },
    {
      accessorKey: "profit",
      header: "الربح",
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return <span className={profitColor(v)}>{fmt(v)}</span>;
      },
      footer: () => {
        const total = categoryList.reduce((s, c) => s + c.profit, 0);
        return <span className={profitColor(total)}>{fmt(total)}</span>;
      },
    },
    {
      id: "margin",
      header: "هامش الربح",
      accessorFn: (row) => row.netRevenue > 0 ? (row.profit / row.netRevenue) * 100 : 0,
      cell: ({ getValue }) => {
        const margin = getValue() as number;
        return <Badge variant={margin > 30 ? "default" : "secondary"} className="tabular-nums text-xs">{margin.toFixed(1)}%</Badge>;
      },
    },
  ], [categoryList, fmt, fmtN, profitColor]);

  const turnoverColumns = useMemo<ColumnDef<TurnoverMetrics>[]>(() => [
    {
      accessorKey: "code",
      header: "الكود",
      cell: ({ getValue }) => <span className="text-muted-foreground text-xs font-mono">{getValue() as string}</span>,
    },
    {
      accessorKey: "name",
      header: "المنتج",
      cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
    },
    {
      accessorKey: "category",
      header: "التصنيف",
      cell: ({ getValue }) => <Badge variant="secondary" className="text-xs font-normal">{getValue() as string}</Badge>,
    },
    {
      accessorKey: "cogs",
      header: "تكلفة المبيعات",
      cell: ({ getValue }) => <span className="tabular-nums">{fmt(getValue() as number)}</span>,
    },
    {
      accessorKey: "avgInventory",
      header: "قيمة المخزون",
      cell: ({ getValue }) => <span className="tabular-nums text-muted-foreground">{fmt(getValue() as number)}</span>,
    },
    {
      accessorKey: "turnover",
      header: "معدل الدوران",
      cell: ({ row }) => {
        const p = row.original;
        return (
          <span className="font-bold tabular-nums text-sm" style={{
            color: p.rating === "excellent" ? TURNOVER_COLORS.excellent : p.rating === "medium" ? TURNOVER_COLORS.medium : p.rating === "slow" ? TURNOVER_COLORS.slow : TURNOVER_COLORS.dead,
          }}>
            {p.turnover}
          </span>
        );
      },
    },
    {
      accessorKey: "currentStock",
      header: "المخزون الحالي",
      cell: ({ row }) => {
        const p = row.original;
        return (
          <span className={`tabular-nums font-medium ${p.currentStock > 0 && p.currentStock < p.minStockLevel ? "text-destructive font-bold" : ""}`}>
            {fmtN(p.currentStock)}
          </span>
        );
      },
    },
    {
      accessorKey: "rating",
      header: "التقييم",
      cell: ({ row }) => {
        const p = row.original;
        const ratingLabels: Record<TurnoverRating, string> = { excellent: "ممتاز", medium: "متوسط", slow: "بطيء", dead: "راكد" };
        return (
          <Badge className="text-xs" style={{
            background: p.rating === "excellent" ? "hsl(152 60% 42% / 0.15)" : p.rating === "medium" ? "hsl(38 92% 50% / 0.15)" : p.rating === "slow" ? "hsl(0 72% 51% / 0.15)" : "hsl(0 50% 30% / 0.15)",
            color: TURNOVER_COLORS[p.rating],
            border: "1px solid currentColor",
          }}>
            {ratingLabels[p.rating]}
          </Badge>
        );
      },
      filterFn: (row, _, filterValue) => row.original.rating === filterValue,
    },
  ], [fmt, fmtN]);


  const handleExport = () => {
    if (view === "top-sellers") {
      exportToExcel({
        filename: "أكثر-المنتجات-مبيعاً",
        sheetName: "الأكثر مبيعاً",
        headers: [
          "الكود",
          "المنتج",
          "التصنيف",
          "الكمية المباعة",
          "المرتجعات",
          "صافي الكمية",
          "الإيرادات",
          "التكلفة الفعلية",
          "الربح",
        ],
        rows: topSellers.map((p) => [
          p.code,
          p.name,
          p.category,
          p.soldQty,
          p.returnedQty,
          p.netQty,
          p.netRevenue,
          p.netCogs,
          p.profit,
        ]),
      });
    } else if (view === "most-profitable") {
      exportToExcel({
        filename: "الأكثر-ربحية",
        sheetName: "الأكثر ربحية",
        headers: ["الكود", "المنتج", "التصنيف", "صافي الإيرادات", "التكلفة الفعلية", "الربح", "هامش الربح %"],
        rows: mostProfitable.map((p) => [
          p.code,
          p.name,
          p.category,
          p.netRevenue,
          p.netCogs,
          p.profit,
          p.netRevenue > 0 ? ((p.profit / p.netRevenue) * 100).toFixed(1) + "%" : "0%",
        ]),
      });
    } else if (view === "by-category") {
      exportToExcel({
        filename: "المبيعات-بالتصنيف",
        sheetName: "بالتصنيف",
        headers: ["التصنيف", "عدد المنتجات", "صافي الكمية", "صافي الإيرادات", "التكلفة", "الربح"],
        rows: categoryList.map((c) => [c.name, c.productCount, c.netQty, c.netRevenue, c.netCogs, c.profit]),
      });
    } else {
      exportToExcel({
        filename: "معدل-دوران-المخزون",
        sheetName: "دوران المخزون",
        headers: [
          "الكود",
          "المنتج",
          "التصنيف",
          "تكلفة المبيعات",
          "قيمة المخزون",
          "معدل الدوران",
          "المخزون الحالي",
          "التقييم",
        ],
        rows: turnoverData.map((p) => [
          p.code,
          p.name,
          p.category,
          p.cogs,
          p.avgInventory,
          p.turnover,
          p.currentStock,
          p.rating === "excellent" ? "ممتاز" : p.rating === "medium" ? "متوسط" : p.rating === "slow" ? "بطيء" : "راكد",
        ]),
      });
    }
  };

  const handlePdfExport = async () => {
    const titles: Record<string, string> = {
      "top-sellers": "أكثر المنتجات مبيعاً",
      "most-profitable": "المنتجات الأكثر ربحية",
      "by-category": "المبيعات حسب التصنيف",
      turnover: "معدل دوران المخزون",
    };
    if (view === "top-sellers") {
      await exportReportPdf({
        title: titles[view],
        settings,
        headers: ["الكود", "المنتج", "التصنيف", "مباع", "مرتجع", "صافي", "الإيرادات", "التكلفة", "الربح"],
        rows: topSellers.map((p) => [
          p.code,
          p.name,
          p.category,
          fmtN(p.soldQty),
          fmtN(p.returnedQty),
          fmtN(p.netQty),
          fmt(p.netRevenue),
          fmt(p.netCogs),
          fmt(p.profit),
        ]),
        filename: "أكثر-المنتجات-مبيعاً",
        orientation: "landscape",
      });
    } else if (view === "most-profitable") {
      await exportReportPdf({
        title: titles[view],
        settings,
        headers: ["الكود", "المنتج", "التصنيف", "الإيرادات", "التكلفة", "الربح", "هامش %"],
        rows: mostProfitable.map((p) => [
          p.code,
          p.name,
          p.category,
          fmt(p.netRevenue),
          fmt(p.netCogs),
          fmt(p.profit),
          p.netRevenue > 0 ? ((p.profit / p.netRevenue) * 100).toFixed(1) + "%" : "0%",
        ]),
        filename: "الأكثر-ربحية",
        orientation: "landscape",
      });
    } else if (view === "by-category") {
      await exportReportPdf({
        title: titles[view],
        settings,
        headers: ["التصنيف", "عدد المنتجات", "صافي الكمية", "الإيرادات", "التكلفة", "الربح"],
        rows: categoryList.map((c) => [
          c.name,
          c.productCount,
          fmtN(c.netQty),
          fmt(c.netRevenue),
          fmt(c.netCogs),
          fmt(c.profit),
        ]),
        filename: "مبيعات-بالتصنيف",
      });
    } else {
      await exportReportPdf({
        title: titles[view],
        settings,
        headers: ["الكود", "المنتج", "التصنيف", "ت.المبيعات", "ق.المخزون", "الدوران", "المخزون", "التقييم"],
        rows: turnoverData.map((p) => [
          p.code,
          p.name,
          p.category,
          fmt(p.cogs),
          fmt(p.avgInventory),
          String(p.turnover),
          fmtN(p.currentStock),
          p.rating === "excellent" ? "ممتاز" : p.rating === "medium" ? "متوسط" : p.rating === "slow" ? "بطيء" : "راكد",
        ]),
        filename: "دوران-المخزون",
        orientation: "landscape",
      });
    }
  };

  return (
    <div className="space-y-5 p-1">
      {/* ── Filters Card ────────────────────────────────────────────────────── */}
      <Card className="border shadow-sm">
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-center justify-between gap-y-3">
            {/* Filters — right side (RTL: visual left) */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              {/* Date Range */}
              <div className="flex items-center gap-2">
                <DatePickerInput value={dateFrom} onChange={setDateFrom} placeholder="من تاريخ" className="w-[140px]" />
                <span className="text-muted-foreground/30">—</span>
                <DatePickerInput value={dateTo} onChange={setDateTo} placeholder="إلى تاريخ" className="w-[140px]" />
              </div>

              <div className="h-7 w-px bg-border/60 hidden md:block" />

              {/* Report Type */}
              <Select value={view} onValueChange={(v: any) => setView(v)}>
                <SelectTrigger className="w-[170px] font-medium h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="top-sellers">الأكثر مبيعاً</SelectItem>
                  <SelectItem value="most-profitable">الأكثر ربحية</SelectItem>
                  <SelectItem value="by-category">حسب التصنيف</SelectItem>
                  <SelectItem value="turnover">دوران المخزون</SelectItem>
                </SelectContent>
              </Select>

              {/* Category Filter */}
              <CategoryTreeSelect
                categories={categories || []}
                value={categoryFilter === "all" ? "" : categoryFilter}
                onValueChange={(id) => setCategoryFilter(id || "all")}
                placeholder="جميع التصنيفات"
                className="w-[170px]"
              />
            </div>

            {/* Export Buttons — far left (RTL: visual right of card) */}
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={isLoading}
                className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300 dark:text-emerald-400 dark:border-emerald-900 dark:hover:bg-emerald-950 transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePdfExport}
                disabled={isLoading}
                className="gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50 hover:border-rose-300 dark:text-rose-400 dark:border-rose-900 dark:hover:bg-rose-950 transition-colors"
              >
                <FileText className="w-4 h-4" />
                PDF
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── KPI Cards ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Sold SKUs */}
        <Card className="relative overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0 shadow-inner">
                <Package className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">أصناف مباعة</p>
                {isLoading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums">{fmtN(kpis.distinctProducts)}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Net Qty */}
        <Card className="relative overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-transparent pointer-events-none" />
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-blue-500/10 flex items-center justify-center shrink-0 shadow-inner">
                <ShoppingCart className="w-5 h-5 text-blue-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">صافي الكميات</p>
                {isLoading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums">{fmtN(kpis.totalNetQty)}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Net Revenue */}
        <Card className="relative overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent pointer-events-none" />
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 flex items-center justify-center shrink-0 shadow-inner">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">صافي الإيرادات</p>
                {isLoading ? (
                  <Skeleton className="h-7 w-20" />
                ) : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums truncate">
                    {fmt(kpis.totalNetRevenue)}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Total Profit */}
        <Card className="relative overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                kpis.totalProfit >= 0
                  ? "linear-gradient(135deg, hsl(152 60% 42% / 0.06) 0%, transparent 60%)"
                  : "linear-gradient(135deg, hsl(0 72% 51% / 0.06) 0%, transparent 60%)",
            }}
          />
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-inner"
                style={{
                  background: kpis.totalProfit >= 0 ? "hsl(152 60% 42% / 0.12)" : "hsl(0 72% 51% / 0.12)",
                }}
              >
                <DollarSign
                  className="w-5 h-5"
                  style={{ color: kpis.totalProfit >= 0 ? "hsl(152, 60%, 42%)" : "hsl(0, 72%, 51%)" }}
                />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">إجمالي الربح</p>
                {isLoading ? (
                  <Skeleton className="h-7 w-20" />
                ) : (
                  <p className={`text-2xl font-extrabold tracking-tight truncate ${profitColor(kpis.totalProfit)}`}>
                    {fmt(kpis.totalProfit)}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Turnover Alerts ──────────────────────────────────────────────────── */}
      {view === "turnover" && !isLoading && (
        <div className="space-y-2">
          {deadStockCount > 0 && (
            <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>{fmtN(deadStockCount)}</strong> منتج راكد بدون مبيعات خلال الفترة — قيمة مخزون محتجز:{" "}
                <strong>{fmt(deadStockValue)}</strong>
              </AlertDescription>
            </Alert>
          )}
          {reorderAlerts.length > 0 && (
            <Alert className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30">
              <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertDescription className="text-sm text-amber-800 dark:text-amber-300">
                <strong>{reorderAlerts.length}</strong> منتج تحت نقطة إعادة الطلب وله مبيعات نشطة:{" "}
                {reorderAlerts
                  .slice(0, 3)
                  .map((p) => p.name)
                  .join("، ")}
                {reorderAlerts.length > 3 ? ` و${reorderAlerts.length - 3} آخرين` : ""}
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* ── Charts ──────────────────────────────────────────────────────────── */}
      {(view === "top-sellers" || view === "most-profitable") && chartData.length > 0 && (
        <Card className="border shadow-sm">
          <CardHeader className="pb-1 pt-4 px-5">
            <CardTitle className="text-sm font-semibold text-foreground/80">
              {view === "top-sellers" ? "الأكثر مبيعاً" : "الأكثر ربحية"}
              <span className="ms-1.5 text-xs font-normal text-muted-foreground">(أعلى 10)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3">
            {isLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 4, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                  <XAxis type="number" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" width={120} fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip
                    formatter={(v: number) => (view === "top-sellers" ? fmtN(v) : fmt(v))}
                    contentStyle={{ borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar
                    dataKey="value"
                    name={view === "top-sellers" ? "صافي الكمية" : "الربح"}
                    fill={view === "top-sellers" ? "hsl(217, 80%, 50%)" : "hsl(152, 60%, 42%)"}
                    radius={[0, 6, 6, 0]}
                    maxBarSize={22}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {view === "by-category" && categoryChartData.length > 0 && (
        <Card className="border shadow-sm">
          <CardHeader className="pb-1 pt-4 px-5">
            <CardTitle className="text-sm font-semibold text-foreground/80">توزيع الإيرادات حسب التصنيف</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[290px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={290}>
                <PieChart>
                  <Pie
                    data={categoryChartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={105}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    fontSize={11}
                    paddingAngle={2}
                  >
                    {categoryChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {view === "turnover" && turnoverDistribution.length > 0 && (
        <Card className="border shadow-sm">
          <CardHeader className="pb-1 pt-4 px-5">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-semibold text-foreground/80">توزيع فئات دوران المخزون</CardTitle>
              <TooltipProvider>
                <UITooltip>
                  <TooltipTrigger>
                    <Info className="w-3.5 h-3.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs text-xs">
                    <p>ممتاز: دوران أكبر من 2 — متوسط: بين 0.5 و 2 — بطيء: أقل من 0.5 — راكد: لم يُبع خلال الفترة</p>
                  </TooltipContent>
                </UITooltip>
              </TooltipProvider>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[290px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={290}>
                <PieChart>
                  <Pie
                    data={turnoverDistribution}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={105}
                    label={({ name, value }) => `${name}: ${value}`}
                    fontSize={11}
                    paddingAngle={3}
                  >
                    {turnoverDistribution.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Legend iconType="circle" iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Data Tables (using DataTable component) ────────────────────────── */}
      {view === "top-sellers" && (
        <DataTable
          columns={topSellersColumns}
          data={topSellers}
          isLoading={isLoading}
          showSearch={true}
          searchPlaceholder="بحث بالاسم أو الكود..."
          showColumnToggle={true}
          showPagination={true}
          pageSize={20}
          emptyMessage="لا توجد مبيعات في هذه الفترة"
          columnLabels={{
            rank: "#",
            code: "الكود",
            name: "المنتج",
            category: "التصنيف",
            soldQty: "مباع",
            returnedQty: "مرتجع",
            netQty: "صافي",
            netRevenue: "الإيرادات",
            netCogs: "التكلفة",
            profit: "الربح",
          }}
        />
      )}

      {view === "most-profitable" && (
        <DataTable
          columns={mostProfitableColumns}
          data={mostProfitable}
          isLoading={isLoading}
          showSearch={true}
          searchPlaceholder="بحث بالاسم أو الكود..."
          showColumnToggle={true}
          showPagination={true}
          pageSize={20}
          emptyMessage="لا توجد بيانات"
          columnLabels={{
            rank: "#",
            code: "الكود",
            name: "المنتج",
            category: "التصنيف",
            netRevenue: "صافي الإيرادات",
            netCogs: "التكلفة",
            profit: "الربح",
            margin: "هامش الربح",
          }}
        />
      )}

      {view === "by-category" && (
        <DataTable
          columns={categoryColumns}
          data={categoryList}
          isLoading={isLoading}
          showSearch={true}
          searchPlaceholder="بحث بالتصنيف..."
          showColumnToggle={true}
          showPagination={true}
          pageSize={20}
          emptyMessage="لا توجد بيانات"
          columnLabels={{
            name: "التصنيف",
            productCount: "عدد المنتجات",
            netQty: "صافي الكمية",
            netRevenue: "صافي الإيرادات",
            netCogs: "التكلفة",
            profit: "الربح",
            margin: "هامش الربح",
          }}
        />
      )}

      {view === "turnover" && (
        <DataTable
          columns={turnoverColumns}
          data={turnoverData}
          isLoading={isLoading}
          showSearch={true}
          searchPlaceholder="بحث بالاسم أو الكود..."
          showColumnToggle={true}
          showPagination={true}
          pageSize={20}
          emptyMessage="لا توجد بيانات"
          columnLabels={{
            code: "الكود",
            name: "المنتج",
            category: "التصنيف",
            cogs: "تكلفة المبيعات",
            avgInventory: "قيمة المخزون",
            turnover: "معدل الدوران",
            currentStock: "المخزون الحالي",
            rating: "التقييم",
          }}
        />
      )}
    </div>
  );
}
