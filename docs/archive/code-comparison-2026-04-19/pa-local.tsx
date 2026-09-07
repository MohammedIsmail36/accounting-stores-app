import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  format,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfDay,
  differenceInCalendarDays,
} from "date-fns";
import { DatePickerInput } from "@/components/DatePickerInput";
import {
  FileSpreadsheet,
  FileText,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Package,
  Medal,
  AlertTriangle,
  Info,
  ShoppingCart,
  RotateCcw,
  Star,
  Layers,
  Zap,
  CalendarDays,
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

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
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

const TURNOVER_COLORS: Record<TurnoverRating, string> = {
  excellent: "hsl(152, 60%, 42%)",
  medium: "hsl(38, 92%, 50%)",
  slow: "hsl(0, 72%, 51%)",
  dead: "hsl(0, 50%, 30%)",
  new: "hsl(217, 80%, 50%)",
};

const TURNOVER_LABELS: Record<TurnoverRating, string> = {
  excellent: "ممتاز",
  medium: "متوسط",
  slow: "بطيء",
  dead: "راكد",
  new: "تحت الاختبار",
};

const ABC_COLORS: Record<ABCClass, string> = {
  A: "#15803d",
  B: "#3b82f6",
  C: "#64748b",
};

// Days before period start — if first purchase is within this window, product is "new/under testing"
const NEW_PRODUCT_THRESHOLD_DAYS = 60;

const VIEW_INFO: Record<ViewType, { icon: JSX.Element; desc: string }> = {
  "top-sellers": {
    icon: <ShoppingCart className="w-4 h-4 text-primary" />,
    desc: "المنتجات الأعلى طلباً من حيث الكمية — عزّز مخزونها وخطّط للتوريد",
  },
  "most-profitable": {
    icon: <TrendingUp className="w-4 h-4 text-emerald-600" />,
    desc: "المنتجات ذات أعلى هامش ربح — وجِّه جهودك البيعية نحوها أولاً",
  },
  "by-category": {
    icon: <Layers className="w-4 h-4 text-blue-600" />,
    desc: "أداء المجموعات البضاعية — اكتشف أي التصنيفات يستحق التوسع وأيها يستحق التقليص",
  },
  turnover: {
    icon: <Zap className="w-4 h-4 text-amber-500" />,
    desc: "كفاءة تحويل المخزون إلى مبيعات — اكشف الأصول الراكدة قبل أن تُثقل رأس المال",
  },
  abc: {
    icon: <Star className="w-4 h-4 text-yellow-500" />,
    desc: "قاعدة باريتو: 20% من منتجاتك تُحقق 80% من إيراداتك — ركّز مواردك عليها",
  },
  returns: {
    icon: <RotateCcw className="w-4 h-4 text-rose-500" />,
    desc: "المنتجات الأعلى معدل إرجاع — راجع جودتها وتسعيرها لوقف نزيف الأرباح",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type ViewType =
  | "top-sellers"
  | "most-profitable"
  | "by-category"
  | "turnover"
  | "abc"
  | "returns";
// "new" = purchased for first time recently (under testing), NOT dead stock
type TurnoverRating = "excellent" | "medium" | "slow" | "dead" | "new";
type ABCClass = "A" | "B" | "C";
type QuickRange = "1" | "3" | "6" | "12" | "custom";

interface ProductMetrics {
  id: string;
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

interface TurnoverMetrics {
  id: string;
  name: string;
  code: string;
  category: string;
  cogs: number;
  avgInventory: number;
  turnover: number;
  daysOfSupply: number | null;
  currentStock: number;
  minStockLevel: number;
  rating: TurnoverRating;
}

interface ABCMetrics {
  name: string;
  code: string;
  category: string;
  netQty: number;
  netRevenue: number;
  revenueShare: number;
  cumulative: number;
  abcClass: ABCClass;
}

interface ReturnMetrics {
  name: string;
  code: string;
  category: string;
  soldQty: number;
  returnedQty: number;
  returnRate: number;
  returnsValue: number;
  profitImpact: number;
}

export default function ProductAnalytics() {
  const { settings } = useSettings();
  const [quickRange, setQuickRange] = useState<QuickRange>("1");
  const [dateFrom, setDateFrom] = useState(
    format(startOfMonth(new Date()), "yyyy-MM-dd"),
  );
  const [dateTo, setDateTo] = useState(
    format(endOfMonth(new Date()), "yyyy-MM-dd"),
  );
  const [view, setView] = useState<ViewType>("top-sellers");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const applyQuickRange = (months: QuickRange) => {
    if (months === "custom") {
      setQuickRange("custom");
      return;
    }
    const n = parseInt(months);
    const to = new Date();
    const from = startOfDay(subMonths(to, n));
    setDateFrom(format(from, "yyyy-MM-dd"));
    setDateTo(format(to, "yyyy-MM-dd"));
    setQuickRange(months);
  };

  const periodDays = useMemo(() => {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    return Math.max(1, differenceInCalendarDays(to, from) + 1);
  }, [dateFrom, dateTo]);

  // Q1: Sales invoice items — only posted invoices, active products
  const { data: salesItems, isLoading: loadingSales } = useQuery({
    queryKey: ["pa-sales", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoice_items")
        .select(
          "quantity, total, net_total, unit_price, product_id, product:products!inner(name, code, category_id, quantity_on_hand, min_stock_level, purchase_price, is_active, created_at, category:product_categories(name)), invoice:sales_invoices!inner(invoice_date, status)",
        )
        .gte("invoice.invoice_date", dateFrom)
        .lte("invoice.invoice_date", dateTo)
        .eq("invoice.status", "posted")
        .eq("product.is_active", true);
      if (error) throw error;
      return data;
    },
  });

  // Q2: Sales return items — only posted returns
  const { data: returnItems, isLoading: loadingReturns } = useQuery({
    queryKey: ["pa-returns", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_return_items")
        .select(
          "quantity, total, product_id, return:sales_returns!inner(return_date, status)",
        )
        .gte("return.return_date", dateFrom)
        .lte("return.return_date", dateTo)
        .eq("return.status", "posted");
      if (error) throw error;
      return data;
    },
  });

  // Q3: Inventory movements (sale + sale_return in period) for exact COGS
  const { data: movements, isLoading: loadingMovements } = useQuery({
    queryKey: ["pa-movements", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select(
          "product_id, movement_type, quantity, total_cost, movement_date",
        )
        .in("movement_type", ["sale", "sale_return"])
        .gte("movement_date", dateFrom)
        .lte("movement_date", dateTo);
      if (error) throw error;
      return data;
    },
  });

  // Q4: All ACTIVE products (with created_at for new-product detection)
  const { data: products, isLoading: loadingProducts } = useQuery({
    queryKey: ["pa-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, name, code, purchase_price, selling_price, quantity_on_hand, min_stock_level, category_id, created_at, category:product_categories(name)",
        )
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  // Q5: Categories for filter dropdown
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

  // Q6: First purchase movement date per product (all-time, no date filter)
  // Used to distinguish "new product under testing" from true dead stock
  const { data: firstPurchaseMovements } = useQuery({
    queryKey: ["pa-first-purchases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("product_id, movement_date")
        .eq("movement_type", "purchase")
        .order("movement_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const isLoading =
    loadingSales || loadingReturns || loadingMovements || loadingProducts;

  const fmt = (n: number) =>
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const fmtN = (n: number) =>
    n.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;

  // ─── First purchase date map ─────────────────────────────────────────────
  const firstPurchaseDates = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    firstPurchaseMovements?.forEach((m: any) => {
      if (!map[m.product_id] || m.movement_date < map[m.product_id]) {
        map[m.product_id] = m.movement_date;
      }
    });
    return map;
  }, [firstPurchaseMovements]);

  // Build product metrics
  const productMetrics = useMemo(() => {
    const metrics: Record<string, ProductMetrics> = {};

    salesItems?.forEach((item: any) => {
      if (!item.product || item.product.is_active === false) return;
      const id = item.product_id || "unknown";
      if (!metrics[id]) {
        metrics[id] = {
          id,
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
          currentStock: Number(item.product?.quantity_on_hand ?? 0),
          minStockLevel: Number(item.product?.min_stock_level ?? 0),
          purchasePrice: Number(item.product?.purchase_price ?? 0),
        };
      }
      metrics[id].soldQty += Number(item.quantity);
      metrics[id].revenue += Number(item.net_total ?? item.total);
    });

    returnItems?.forEach((item: any) => {
      const id = item.product_id || "unknown";
      if (!metrics[id]) return;
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
    const allSold = filteredMetrics.filter((p) => p.soldQty > 0);
    const totalSoldQty = filteredMetrics.reduce((s, p) => s + p.soldQty, 0);
    const totalReturnedQty = filteredMetrics.reduce(
      (s, p) => s + p.returnedQty,
      0,
    );
    const totalNetQty = filteredMetrics.reduce((s, p) => s + p.netQty, 0);
    const totalNetRevenue = filteredMetrics.reduce(
      (s, p) => s + p.netRevenue,
      0,
    );
    const totalReturnsValue = filteredMetrics.reduce(
      (s, p) => s + p.returnsValue,
      0,
    );
    const totalProfit = filteredMetrics.reduce((s, p) => s + p.profit, 0);
    const overallMargin =
      totalNetRevenue > 0 ? (totalProfit / totalNetRevenue) * 100 : 0;
    const topMargin =
      allSold.length > 0
        ? Math.max(
            ...allSold.map((p) =>
              p.netRevenue > 0 ? (p.profit / p.netRevenue) * 100 : 0,
            ),
          )
        : 0;
    const overallReturnRate =
      totalSoldQty > 0 ? (totalReturnedQty / totalSoldQty) * 100 : 0;
    return {
      distinctProducts: allSold.length,
      totalNetQty,
      totalNetRevenue,
      totalProfit,
      overallMargin,
      topMargin,
      overallReturnRate,
      totalReturnsValue,
      totalReturnsImpact: filteredMetrics.reduce(
        (s, p) => s + p.returnsValue - p.returnsCogs,
        0,
      ),
    };
  }, [filteredMetrics]);

  const topSellers = useMemo(
    () => [...filteredMetrics].sort((a, b) => b.netQty - a.netQty),
    [filteredMetrics],
  );
  const mostProfitable = useMemo(
    () => [...filteredMetrics].sort((a, b) => b.profit - a.profit),
    [filteredMetrics],
  );

  const categoryList = useMemo<CategoryMetrics[]>(() => {
    const cats: Record<string, CategoryMetrics> = {};
    filteredMetrics.forEach((p) => {
      if (!cats[p.category])
        cats[p.category] = {
          name: p.category,
          productCount: 0,
          netQty: 0,
          netRevenue: 0,
          netCogs: 0,
          profit: 0,
        };
      cats[p.category].productCount++;
      cats[p.category].netQty += p.netQty;
      cats[p.category].netRevenue += p.netRevenue;
      cats[p.category].netCogs += p.netCogs;
      cats[p.category].profit += p.profit;
    });
    return Object.values(cats).sort((a, b) => b.netRevenue - a.netRevenue);
  }, [filteredMetrics]);

  const turnoverData = useMemo<TurnoverMetrics[]>(() => {
    const allProducts = products ?? [];
    const filtered =
      categoryFilter === "all"
        ? allProducts
        : allProducts.filter((p: any) => p.category_id === categoryFilter);

    return filtered
      .map((p: any) => {
        const m = productMetrics[p.id];
        const hasSales = m && m.soldQty > 0;
        const cogs = m?.netCogs ?? 0;
        const currentStockValue =
          Number(p.quantity_on_hand) * Number(p.purchase_price);
        const avgInventory = currentStockValue > 0 ? currentStockValue : 1;
        const turnover =
          cogs > 0 ? Math.round((cogs / avgInventory) * 100) / 100 : 0;

        const netQtyInPeriod = m?.netQty ?? 0;
        const dailyRate = netQtyInPeriod > 0 ? netQtyInPeriod / periodDays : 0;
        const daysOfSupply =
          dailyRate > 0
            ? Math.round(Number(p.quantity_on_hand) / dailyRate)
            : null;

        // Determine "new product under testing":
        // No sales AND first-ever purchase was within NEW_PRODUCT_THRESHOLD_DAYS before dateFrom
        const firstPurchase = firstPurchaseDates[p.id];
        const isNewProduct =
          !hasSales &&
          (() => {
            if (!firstPurchase) return true;
            const daysSince = differenceInCalendarDays(
              new Date(dateFrom),
              new Date(firstPurchase),
            );
            return daysSince <= NEW_PRODUCT_THRESHOLD_DAYS;
          })();

        let rating: TurnoverRating;
        if (isNewProduct) {
          rating = "new";
        } else if (!hasSales) {
          rating = Number(p.quantity_on_hand) === 0 ? "slow" : "dead";
        } else if (turnover > 2) {
          rating = "excellent";
        } else if (turnover > 0.5) {
          rating = "medium";
        } else {
          rating = "slow";
        }

        return {
          id: p.id,
          name: p.name,
          code: p.code,
          category: p.category?.name || "بدون تصنيف",
          cogs,
          avgInventory: currentStockValue,
          turnover,
          daysOfSupply,
          currentStock: Number(p.quantity_on_hand),
          minStockLevel: Number(p.min_stock_level),
          rating,
        };
      })
      .sort((a, b) => {
        const order: Record<TurnoverRating, number> = {
          excellent: 0,
          medium: 1,
          slow: 2,
          new: 3,
          dead: 4,
        };
        const diff = order[a.rating] - order[b.rating];
        return diff !== 0 ? diff : b.turnover - a.turnover;
      });
  }, [
    products,
    productMetrics,
    categoryFilter,
    firstPurchaseDates,
    dateFrom,
    periodDays,
  ]);

  const deadStockItems = useMemo(
    () => turnoverData.filter((p) => p.rating === "dead" && p.currentStock > 0),
    [turnoverData],
  );
  const deadStockValue = deadStockItems.reduce((s, p) => s + p.avgInventory, 0);

  const reorderAlerts = useMemo(
    () =>
      turnoverData.filter(
        (p) =>
          p.currentStock > 0 &&
          p.currentStock < p.minStockLevel &&
          p.rating !== "dead" &&
          p.rating !== "new",
      ),
    [turnoverData],
  );

  const newProductsCount = useMemo(
    () => turnoverData.filter((p) => p.rating === "new").length,
    [turnoverData],
  );

  // ─── ABC Analysis ─────────────────────────────────────────────────────────
  const abcData = useMemo<ABCMetrics[]>(() => {
    const totalRevenue = filteredMetrics.reduce((s, p) => s + p.netRevenue, 0);
    if (totalRevenue <= 0) return [];
    const sorted = [...filteredMetrics]
      .filter((p) => p.netRevenue > 0)
      .sort((a, b) => b.netRevenue - a.netRevenue);
    let cumulative = 0;
    return sorted.map((p) => {
      const revenueShare = (p.netRevenue / totalRevenue) * 100;
      cumulative += revenueShare;
      const abcClass: ABCClass =
        cumulative <= 70 ? "A" : cumulative <= 90 ? "B" : "C";
      return {
        name: p.name,
        code: p.code,
        category: p.category,
        netQty: p.netQty,
        netRevenue: p.netRevenue,
        revenueShare,
        cumulative,
        abcClass,
      };
    });
  }, [filteredMetrics]);

  const abcKpis = useMemo(() => {
    const A = abcData.filter((p) => p.abcClass === "A");
    const B = abcData.filter((p) => p.abcClass === "B");
    const C = abcData.filter((p) => p.abcClass === "C");
    const totalRevenue = abcData.reduce((s, p) => s + p.netRevenue, 0);
    return {
      countA: A.length,
      countB: B.length,
      countC: C.length,
      aRevenuePct:
        totalRevenue > 0
          ? (A.reduce((s, p) => s + p.netRevenue, 0) / totalRevenue) * 100
          : 0,
    };
  }, [abcData]);

  // ─── Returns Analysis ─────────────────────────────────────────────────────
  const MIN_SOLD_FOR_RETURN_RATE = 5;
  const returnMetrics = useMemo<ReturnMetrics[]>(() => {
    return filteredMetrics
      .filter((p) => p.soldQty >= MIN_SOLD_FOR_RETURN_RATE)
      .map((p) => ({
        name: p.name,
        code: p.code,
        category: p.category,
        soldQty: p.soldQty,
        returnedQty: p.returnedQty,
        returnRate: p.soldQty > 0 ? (p.returnedQty / p.soldQty) * 100 : 0,
        returnsValue: p.returnsValue,
        profitImpact: p.returnsValue - p.returnsCogs,
      }))
      .sort((a, b) => b.returnRate - a.returnRate);
  }, [filteredMetrics]);

  const returnKpis = useMemo(() => {
    const totalSold = returnMetrics.reduce((s, p) => s + p.soldQty, 0);
    const totalReturned = returnMetrics.reduce((s, p) => s + p.returnedQty, 0);
    return {
      overallRate: totalSold > 0 ? (totalReturned / totalSold) * 100 : 0,
      totalValue: returnMetrics.reduce((s, p) => s + p.returnsValue, 0),
      highRateProducts: returnMetrics.filter((p) => p.returnRate > 30).length,
      worstProduct: returnMetrics[0],
    };
  }, [returnMetrics]);

  // ─── Charts ────────────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (view === "top-sellers")
      return topSellers.slice(0, 10).map((p) => ({
        name: p.name.length > 15 ? p.name.slice(0, 15) + "…" : p.name,
        value: p.netQty,
      }));
    if (view === "most-profitable")
      return mostProfitable.slice(0, 10).map((p) => ({
        name: p.name.length > 15 ? p.name.slice(0, 15) + "…" : p.name,
        value: p.profit,
      }));
    return [];
  }, [view, topSellers, mostProfitable]);

  const categoryChartData = useMemo(
    () =>
      categoryList.map((c, i) => ({
        name: c.name,
        value: c.netRevenue,
        color: CHART_COLORS[i % CHART_COLORS.length],
      })),
    [categoryList],
  );

  const turnoverDistribution = useMemo(() => {
    const dist: Record<TurnoverRating, number> = {
      excellent: 0,
      medium: 0,
      slow: 0,
      dead: 0,
      new: 0,
    };
    turnoverData.forEach((p) => {
      dist[p.rating]++;
    });
    return (Object.entries(dist) as [TurnoverRating, number][])
      .filter(([, v]) => v > 0)
      .map(([key, value]) => ({
        name: TURNOVER_LABELS[key],
        value,
        color: TURNOVER_COLORS[key],
      }));
  }, [turnoverData]);

  const abcChartData = useMemo(() => {
    const counts: Record<ABCClass, number> = { A: 0, B: 0, C: 0 };
    const revenue: Record<ABCClass, number> = { A: 0, B: 0, C: 0 };
    abcData.forEach((p) => {
      counts[p.abcClass]++;
      revenue[p.abcClass] += p.netRevenue;
    });
    return (["A", "B", "C"] as ABCClass[])
      .filter((c) => counts[c] > 0)
      .map((c) => ({
        name: `الفئة ${c}`,
        value: counts[c],
        revenue: revenue[c],
        color: ABC_COLORS[c],
      }));
  }, [abcData]);

  // ─── Design-only helpers ─────────────────────────────────────────────────
  const medalIcon = (index: number) => {
    if (index === 0)
      return <Medal className="w-4 h-4 text-yellow-500 drop-shadow-sm" />;
    if (index === 1)
      return <Medal className="w-4 h-4 text-slate-400 drop-shadow-sm" />;
    if (index === 2)
      return <Medal className="w-4 h-4 text-amber-700 drop-shadow-sm" />;
    return (
      <span className="text-muted-foreground/60 text-xs font-medium tabular-nums">
        {index + 1}
      </span>
    );
  };

  const profitColor = (val: number) =>
    val >= 0
      ? "text-emerald-600 dark:text-emerald-400 font-bold tabular-nums"
      : "text-destructive font-bold tabular-nums";

  const marginBadge = (margin: number) => {
    if (margin >= 30)
      return (
        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 tabular-nums text-xs font-normal">
          {fmtPct(margin)}
        </Badge>
      );
    if (margin >= 15)
      return (
        <Badge variant="secondary" className="tabular-nums text-xs font-normal">
          {fmtPct(margin)}
        </Badge>
      );
    return (
      <Badge variant="destructive" className="tabular-nums text-xs font-normal">
        {fmtPct(margin)}
      </Badge>
    );
  };

  // ─── Column Definitions ────────────────────────────────────────────────────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const topSellersColumns = useMemo<ColumnDef<ProductMetrics>[]>(
    () => [
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
        cell: ({ getValue }) => (
          <span className="text-muted-foreground text-xs font-mono">
            {getValue() as string}
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: "المنتج",
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "category",
        header: "التصنيف",
        cell: ({ getValue }) => (
          <Badge variant="secondary" className="text-xs font-normal">
            {getValue() as string}
          </Badge>
        ),
      },
      {
        accessorKey: "soldQty",
        header: "مباع",
        cell: ({ getValue }) => (
          <span className="tabular-nums">{fmtN(getValue() as number)}</span>
        ),
        footer: () => (
          <span className="tabular-nums font-bold">
            {fmtN(topSellers.reduce((s, p) => s + p.soldQty, 0))}
          </span>
        ),
      },
      {
        accessorKey: "returnedQty",
        header: "مرتجع",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return v > 0 ? (
            <span className="tabular-nums text-destructive/80">{fmtN(v)}</span>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          );
        },
        footer: () => (
          <span className="tabular-nums font-bold text-destructive/80">
            {fmtN(topSellers.reduce((s, p) => s + p.returnedQty, 0))}
          </span>
        ),
      },
      {
        accessorKey: "netQty",
        header: "صافي",
        cell: ({ getValue }) => (
          <span className="font-semibold tabular-nums">
            {fmtN(getValue() as number)}
          </span>
        ),
        footer: () => (
          <span className="tabular-nums font-bold">
            {fmtN(topSellers.reduce((s, p) => s + p.netQty, 0))}
          </span>
        ),
      },
      {
        accessorKey: "netRevenue",
        header: "الإيرادات",
        cell: ({ getValue }) => (
          <span className="tabular-nums">{fmt(getValue() as number)}</span>
        ),
        footer: () => (
          <span className="tabular-nums font-bold">
            {fmt(topSellers.reduce((s, p) => s + p.netRevenue, 0))}
          </span>
        ),
      },
      {
        accessorKey: "netCogs",
        header: "التكلفة",
        cell: ({ getValue }) => (
          <span className="tabular-nums text-muted-foreground">
            {fmt(getValue() as number)}
          </span>
        ),
        footer: () => (
          <span className="tabular-nums font-bold text-muted-foreground">
            {fmt(topSellers.reduce((s, p) => s + p.netCogs, 0))}
          </span>
        ),
      },
      {
        accessorKey: "profit",
        header: "الربح",
        cell: ({ getValue }) => (
          <span className={profitColor(getValue() as number)}>
            {fmt(getValue() as number)}
          </span>
        ),
        footer: () => {
          const t = topSellers.reduce((s, p) => s + p.profit, 0);
          return <span className={profitColor(t)}>{fmt(t)}</span>;
        },
      },
      {
        id: "returnRate",
        header: "معدل الإرجاع",
        accessorFn: (row) =>
          row.soldQty > 0 ? (row.returnedQty / row.soldQty) * 100 : 0,
        cell: ({ getValue }) => {
          const v = getValue() as number;
          if (v === 0)
            return <span className="text-muted-foreground/40">—</span>;
          return (
            <Badge
              variant={
                v > 30 ? "destructive" : v > 10 ? "secondary" : "outline"
              }
              className="tabular-nums text-xs"
            >
              {fmtPct(v)}
            </Badge>
          );
        },
      },
      {
        id: "margin",
        header: "هامش الربح",
        accessorFn: (row) =>
          row.netRevenue > 0 ? (row.profit / row.netRevenue) * 100 : 0,
        cell: ({ getValue }) => marginBadge(getValue() as number),
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    ],
    [topSellers],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mostProfitableColumns = useMemo<ColumnDef<ProductMetrics>[]>(
    () => [
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
        cell: ({ getValue }) => (
          <span className="text-muted-foreground text-xs font-mono">
            {getValue() as string}
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: "المنتج",
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "category",
        header: "التصنيف",
        cell: ({ getValue }) => (
          <Badge variant="secondary" className="text-xs font-normal">
            {getValue() as string}
          </Badge>
        ),
      },
      {
        accessorKey: "netRevenue",
        header: "صافي الإيرادات",
        cell: ({ getValue }) => (
          <span className="tabular-nums">{fmt(getValue() as number)}</span>
        ),
        footer: () => (
          <span className="tabular-nums font-bold">
            {fmt(mostProfitable.reduce((s, p) => s + p.netRevenue, 0))}
          </span>
        ),
      },
      {
        accessorKey: "netCogs",
        header: "التكلفة",
        cell: ({ getValue }) => (
          <span className="tabular-nums text-muted-foreground">
            {fmt(getValue() as number)}
          </span>
        ),
        footer: () => (
          <span className="tabular-nums font-bold text-muted-foreground">
            {fmt(mostProfitable.reduce((s, p) => s + p.netCogs, 0))}
          </span>
        ),
      },
      {
        accessorKey: "profit",
        header: "الربح",
        cell: ({ getValue }) => (
          <span className={profitColor(getValue() as number)}>
            {fmt(getValue() as number)}
          </span>
        ),
        footer: () => {
          const t = mostProfitable.reduce((s, p) => s + p.profit, 0);
          return <span className={profitColor(t)}>{fmt(t)}</span>;
        },
      },
      {
        id: "margin",
        header: "هامش الربح",
        accessorFn: (row) =>
          row.netRevenue > 0 ? (row.profit / row.netRevenue) * 100 : 0,
        cell: ({ getValue }) => marginBadge(getValue() as number),
      },
      {
        id: "profitPerUnit",
        header: "ربح/وحدة",
        accessorFn: (row) => (row.netQty > 0 ? row.profit / row.netQty : 0),
        cell: ({ getValue }) => (
          <span className={profitColor(getValue() as number)}>
            {fmt(getValue() as number)}
          </span>
        ),
      },
      {
        id: "avgPrice",
        header: "متوسط البيع",
        accessorFn: (row) => (row.netQty > 0 ? row.netRevenue / row.netQty : 0),
        cell: ({ getValue }) => (
          <span className="tabular-nums">{fmt(getValue() as number)}</span>
        ),
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    ],
    [mostProfitable],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const categoryColumns = useMemo<ColumnDef<CategoryMetrics>[]>(
    () => [
      {
        accessorKey: "name",
        header: "التصنيف",
        cell: ({ getValue }) => (
          <span className="font-semibold">{getValue() as string}</span>
        ),
        footer: () => <span className="font-bold">الإجمالي</span>,
      },
      {
        accessorKey: "productCount",
        header: "عدد المنتجات",
        cell: ({ getValue }) => (
          <span className="tabular-nums">{getValue() as number}</span>
        ),
        footer: () => (
          <span className="tabular-nums font-bold">
            {categoryList.reduce((s, c) => s + c.productCount, 0)}
          </span>
        ),
      },
      {
        accessorKey: "netQty",
        header: "صافي الكمية",
        cell: ({ getValue }) => (
          <span className="tabular-nums">{fmtN(getValue() as number)}</span>
        ),
        footer: () => (
          <span className="tabular-nums font-bold">
            {fmtN(categoryList.reduce((s, c) => s + c.netQty, 0))}
          </span>
        ),
      },
      {
        accessorKey: "netRevenue",
        header: "صافي الإيرادات",
        cell: ({ getValue }) => (
          <span className="tabular-nums">{fmt(getValue() as number)}</span>
        ),
        footer: () => (
          <span className="tabular-nums font-bold">
            {fmt(categoryList.reduce((s, c) => s + c.netRevenue, 0))}
          </span>
        ),
      },
      {
        accessorKey: "netCogs",
        header: "التكلفة",
        cell: ({ getValue }) => (
          <span className="tabular-nums text-muted-foreground">
            {fmt(getValue() as number)}
          </span>
        ),
        footer: () => (
          <span className="tabular-nums font-bold text-muted-foreground">
            {fmt(categoryList.reduce((s, c) => s + c.netCogs, 0))}
          </span>
        ),
      },
      {
        accessorKey: "profit",
        header: "الربح",
        cell: ({ getValue }) => (
          <span className={profitColor(getValue() as number)}>
            {fmt(getValue() as number)}
          </span>
        ),
        footer: () => {
          const t = categoryList.reduce((s, c) => s + c.profit, 0);
          return <span className={profitColor(t)}>{fmt(t)}</span>;
        },
      },
      {
        id: "margin",
        header: "هامش الربح",
        accessorFn: (row) =>
          row.netRevenue > 0 ? (row.profit / row.netRevenue) * 100 : 0,
        cell: ({ getValue }) => marginBadge(getValue() as number),
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    ],
    [categoryList],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const turnoverColumns = useMemo<ColumnDef<TurnoverMetrics>[]>(
    () => [
      {
        accessorKey: "code",
        header: "الكود",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground text-xs font-mono">
            {getValue() as string}
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: "المنتج",
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "category",
        header: "التصنيف",
        cell: ({ getValue }) => (
          <Badge variant="secondary" className="text-xs font-normal">
            {getValue() as string}
          </Badge>
        ),
      },
      {
        accessorKey: "cogs",
        header: "تكلفة المبيعات",
        cell: ({ getValue }) => (
          <span className="tabular-nums">{fmt(getValue() as number)}</span>
        ),
      },
      {
        accessorKey: "avgInventory",
        header: "قيمة المخزون",
        cell: ({ getValue }) => (
          <span className="tabular-nums text-muted-foreground">
            {fmt(getValue() as number)}
          </span>
        ),
      },
      {
        accessorKey: "turnover",
        header: "معدل الدوران",
        cell: ({ row }) => {
          const p = row.original;
          if (p.rating === "new")
            return (
              <span className="text-blue-500 text-xs font-medium">جديد</span>
            );
          return (
            <span
              className="font-bold tabular-nums text-sm"
              style={{ color: TURNOVER_COLORS[p.rating] }}
            >
              {p.turnover > 0 ? p.turnover : "—"}
            </span>
          );
        },
      },
      {
        accessorKey: "daysOfSupply",
        header: "أيام التغطية",
        cell: ({ getValue }) => {
          const v = getValue() as number | null;
          if (v === null)
            return <span className="text-muted-foreground/40">—</span>;
          return (
            <span
              className={`tabular-nums text-sm font-medium ${v < 7 ? "text-destructive" : v < 30 ? "text-amber-500" : "text-emerald-600"}`}
            >
              {fmtN(v)}
            </span>
          );
        },
      },
      {
        accessorKey: "currentStock",
        header: "المخزون",
        cell: ({ row }) => {
          const p = row.original;
          const isLow = p.currentStock > 0 && p.currentStock < p.minStockLevel;
          return (
            <span
              className={`tabular-nums font-medium ${isLow ? "text-destructive font-bold" : ""}`}
            >
              {fmtN(p.currentStock)}
              {isLow && (
                <AlertTriangle className="inline w-3 h-3 ml-1 text-destructive" />
              )}
            </span>
          );
        },
      },
      {
        accessorKey: "rating",
        header: "التقييم",
        cell: ({ row }) => {
          const p = row.original;
          return (
            <Badge
              className="text-xs"
              style={{
                background: `${TURNOVER_COLORS[p.rating]}22`,
                color: TURNOVER_COLORS[p.rating],
                border: `1px solid ${TURNOVER_COLORS[p.rating]}55`,
              }}
            >
              {TURNOVER_LABELS[p.rating]}
            </Badge>
          );
        },
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    ],
    [fmt, fmtN],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const abcColumns = useMemo<ColumnDef<ABCMetrics>[]>(
    () => [
      {
        id: "rank",
        header: "#",
        cell: ({ row }) => (
          <span className="text-muted-foreground/60 text-xs tabular-nums">
            {row.index + 1}
          </span>
        ),
        size: 50,
        enableSorting: false,
      },
      {
        accessorKey: "code",
        header: "الكود",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground text-xs font-mono">
            {getValue() as string}
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: "المنتج",
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "category",
        header: "التصنيف",
        cell: ({ getValue }) => (
          <Badge variant="secondary" className="text-xs font-normal">
            {getValue() as string}
          </Badge>
        ),
      },
      {
        accessorKey: "netQty",
        header: "الكمية",
        cell: ({ getValue }) => (
          <span className="tabular-nums">{fmtN(getValue() as number)}</span>
        ),
      },
      {
        accessorKey: "netRevenue",
        header: "الإيرادات",
        cell: ({ getValue }) => (
          <span className="tabular-nums font-medium">
            {fmt(getValue() as number)}
          </span>
        ),
        footer: () => (
          <span className="tabular-nums font-bold">
            {fmt(abcData.reduce((s, p) => s + p.netRevenue, 0))}
          </span>
        ),
      },
      {
        accessorKey: "revenueShare",
        header: "الحصة %",
        cell: ({ getValue }) => (
          <span className="tabular-nums">{fmtPct(getValue() as number)}</span>
        ),
      },
      {
        accessorKey: "cumulative",
        header: "التراكمي %",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <span
              className={`tabular-nums font-medium ${v <= 70 ? "text-emerald-600" : v <= 90 ? "text-blue-500" : "text-slate-500"}`}
            >
              {fmtPct(v)}
            </span>
          );
        },
      },
      {
        accessorKey: "abcClass",
        header: "التصنيف ABC",
        cell: ({ getValue }) => {
          const cls = getValue() as ABCClass;
          return (
            <Badge
              style={{
                background: `${ABC_COLORS[cls]}22`,
                color: ABC_COLORS[cls],
                border: `1px solid ${ABC_COLORS[cls]}66`,
              }}
              className="font-bold text-sm w-7 justify-center"
            >
              {cls}
            </Badge>
          );
        },
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    ],
    [abcData],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const returnColumns = useMemo<ColumnDef<ReturnMetrics>[]>(
    () => [
      {
        id: "rank",
        header: "#",
        cell: ({ row }) => (
          <span className="text-muted-foreground/60 text-xs tabular-nums">
            {row.index + 1}
          </span>
        ),
        size: 50,
        enableSorting: false,
      },
      {
        accessorKey: "code",
        header: "الكود",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground text-xs font-mono">
            {getValue() as string}
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: "المنتج",
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "category",
        header: "التصنيف",
        cell: ({ getValue }) => (
          <Badge variant="secondary" className="text-xs font-normal">
            {getValue() as string}
          </Badge>
        ),
      },
      {
        accessorKey: "soldQty",
        header: "مباع",
        cell: ({ getValue }) => (
          <span className="tabular-nums">{fmtN(getValue() as number)}</span>
        ),
        footer: () => (
          <span className="tabular-nums font-bold">
            {fmtN(returnMetrics.reduce((s, p) => s + p.soldQty, 0))}
          </span>
        ),
      },
      {
        accessorKey: "returnedQty",
        header: "مرتجع",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return v > 0 ? (
            <span className="tabular-nums text-destructive font-medium">
              {fmtN(v)}
            </span>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          );
        },
        footer: () => (
          <span className="tabular-nums font-bold text-destructive">
            {fmtN(returnMetrics.reduce((s, p) => s + p.returnedQty, 0))}
          </span>
        ),
      },
      {
        accessorKey: "returnRate",
        header: "معدل الإرجاع %",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          if (v === 0)
            return <span className="text-muted-foreground/40">—</span>;
          return (
            <Badge
              variant={
                v > 30 ? "destructive" : v > 10 ? "secondary" : "outline"
              }
              className="tabular-nums text-xs font-bold"
            >
              {fmtPct(v)}
            </Badge>
          );
        },
      },
      {
        accessorKey: "returnsValue",
        header: "قيمة المرتجعات",
        cell: ({ getValue }) => (
          <span className="tabular-nums text-destructive/80">
            {fmt(getValue() as number)}
          </span>
        ),
        footer: () => (
          <span className="tabular-nums font-bold text-destructive/80">
            {fmt(returnMetrics.reduce((s, p) => s + p.returnsValue, 0))}
          </span>
        ),
      },
      {
        accessorKey: "profitImpact",
        header: "أثر على الربح",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <TooltipProvider>
              <UITooltip>
                <TooltipTrigger>
                  <span
                    className={
                      v > 0
                        ? "tabular-nums text-destructive font-bold"
                        : "tabular-nums text-muted-foreground"
                    }
                  >
                    {fmt(v)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  الفرق بين قيمة المرتجع وتكلفته
                </TooltipContent>
              </UITooltip>
            </TooltipProvider>
          );
        },
        footer: () => {
          const t = returnMetrics.reduce((s, p) => s + p.profitImpact, 0);
          return (
            <span
              className={
                t > 0
                  ? "tabular-nums font-bold text-destructive"
                  : "tabular-nums font-bold"
              }
            >
              {fmt(t)}
            </span>
          );
        },
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    ],
    [returnMetrics],
  );

  // ─── Export helpers ────────────────────────────────────────────────────────
  const metaRows: Array<[string, string]> = [
    ["الفترة", `${dateFrom}  →  ${dateTo}`],
    ["تاريخ الاستخراج", format(new Date(), "yyyy-MM-dd HH:mm")],
  ];

  const handleExport = () => {
    if (view === "top-sellers") {
      exportToExcel({
        filename: "الأكثر-مبيعاً",
        sheetName: "الأكثر مبيعاً",
        title: "تقرير المنتجات الأكثر مبيعاً",
        metaRows,
        totalsRow: true,
        headers: [
          "الكود",
          "المنتج",
          "التصنيف",
          "مباع",
          "مرتجع",
          "صافي",
          "الإيرادات",
          "التكلفة",
          "الربح",
          "معدل الإرجاع %",
          "هامش الربح %",
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
          p.soldQty > 0 ? (p.returnedQty / p.soldQty) * 100 : 0,
          p.netRevenue > 0 ? (p.profit / p.netRevenue) * 100 : 0,
        ]),
      });
    } else if (view === "most-profitable") {
      exportToExcel({
        filename: "الأكثر-ربحية",
        sheetName: "الأكثر ربحية",
        title: "تقرير المنتجات الأكثر ربحية",
        metaRows,
        totalsRow: true,
        headers: [
          "الكود",
          "المنتج",
          "التصنيف",
          "الإيرادات",
          "التكلفة",
          "الربح",
          "هامش الربح %",
          "ربح/وحدة",
          "متوسط البيع",
        ],
        rows: mostProfitable.map((p) => [
          p.code,
          p.name,
          p.category,
          p.netRevenue,
          p.netCogs,
          p.profit,
          p.netRevenue > 0 ? (p.profit / p.netRevenue) * 100 : 0,
          p.netQty > 0 ? p.profit / p.netQty : 0,
          p.netQty > 0 ? p.netRevenue / p.netQty : 0,
        ]),
      });
    } else if (view === "by-category") {
      exportToExcel({
        filename: "المبيعات-بالتصنيف",
        sheetName: "بالتصنيف",
        title: "تقرير المبيعات حسب التصنيف",
        metaRows,
        totalsRow: true,
        headers: [
          "التصنيف",
          "عدد المنتجات",
          "صافي الكمية",
          "الإيرادات",
          "التكلفة",
          "الربح",
          "هامش الربح %",
          "حصة الإيرادات %",
        ],
        rows: (() => {
          const totalRev = categoryList.reduce((s, c) => s + c.netRevenue, 0);
          return categoryList.map((c) => [
            c.name,
            c.productCount,
            c.netQty,
            c.netRevenue,
            c.netCogs,
            c.profit,
            c.netRevenue > 0 ? (c.profit / c.netRevenue) * 100 : 0,
            totalRev > 0 ? (c.netRevenue / totalRev) * 100 : 0,
          ]);
        })(),
      });
    } else if (view === "turnover") {
      exportToExcel({
        filename: "دوران-المخزون",
        sheetName: "دوران المخزون",
        title: "تقرير دوران المخزون",
        metaRows,
        headers: [
          "الكود",
          "المنتج",
          "التصنيف",
          "تكلفة المبيعات",
          "قيمة المخزون",
          "معدل الدوران",
          "أيام التغطية",
          "المخزون الحالي",
          "الحد الأدنى",
          "التقييم",
        ],
        rows: turnoverData.map((p) => [
          p.code,
          p.name,
          p.category,
          p.cogs,
          p.avgInventory,
          p.turnover,
          p.daysOfSupply ?? "",
          p.currentStock,
          p.minStockLevel,
          TURNOVER_LABELS[p.rating],
        ]),
      });
    } else if (view === "abc") {
      exportToExcel({
        filename: "تحليل-ABC",
        sheetName: "تحليل ABC",
        title: "تحليل ABC - قاعدة باريتو",
        metaRows,
        headers: [
          "#",
          "الكود",
          "المنتج",
          "التصنيف",
          "الكمية",
          "الإيرادات",
          "الحصة %",
          "التراكمي %",
          "التصنيف ABC",
        ],
        rows: abcData.map((p, i) => [
          i + 1,
          p.code,
          p.name,
          p.category,
          p.netQty,
          p.netRevenue,
          p.revenueShare,
          p.cumulative,
          p.abcClass,
        ]),
      });
    } else {
      exportToExcel({
        filename: "تحليل-المرتجعات",
        sheetName: "المرتجعات",
        title: "تقرير تحليل المرتجعات",
        metaRows,
        totalsRow: true,
        headers: [
          "الكود",
          "المنتج",
          "التصنيف",
          "مباع",
          "مرتجع",
          "معدل الإرجاع %",
          "قيمة المرتجعات",
          "أثر على الربح",
        ],
        rows: returnMetrics.map((p) => [
          p.code,
          p.name,
          p.category,
          p.soldQty,
          p.returnedQty,
          p.returnRate,
          p.returnsValue,
          p.profitImpact,
        ]),
      });
    }
  };

  const handlePdfExport = async () => {
    const currency = settings?.default_currency ?? "";
    if (view === "top-sellers") {
      await exportReportPdf({
        title: "المنتجات الأكثر مبيعاً",
        settings,
        headers: [
          "الكود",
          "المنتج",
          "التصنيف",
          "مباع",
          "مرتجع",
          "صافي",
          "الإيرادات",
          "التكلفة",
          "الربح",
        ],
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
        summaryCards: [
          { label: "أصناف مباعة", value: fmtN(kpis.distinctProducts) },
          { label: "صافي الكمية", value: fmtN(kpis.totalNetQty) },
          {
            label: "إجمالي الإيرادات",
            value: `${fmt(kpis.totalNetRevenue)} ${currency}`,
          },
          { label: "معدل المرتجعات", value: fmtPct(kpis.overallReturnRate) },
        ],
        filename: "الأكثر-مبيعاً",
        orientation: "landscape",
      });
    } else if (view === "most-profitable") {
      await exportReportPdf({
        title: "المنتجات الأكثر ربحية",
        settings,
        headers: [
          "الكود",
          "المنتج",
          "التصنيف",
          "الإيرادات",
          "التكلفة",
          "الربح",
          "هامش %",
        ],
        rows: mostProfitable.map((p) => [
          p.code,
          p.name,
          p.category,
          fmt(p.netRevenue),
          fmt(p.netCogs),
          fmt(p.profit),
          p.netRevenue > 0 ? fmtPct((p.profit / p.netRevenue) * 100) : "0%",
        ]),
        summaryCards: [
          {
            label: "إجمالي الربح",
            value: `${fmt(kpis.totalProfit)} ${currency}`,
          },
          { label: "متوسط الهامش", value: fmtPct(kpis.overallMargin) },
          { label: "أعلى هامش", value: fmtPct(kpis.topMargin) },
          { label: "عدد المنتجات", value: fmtN(kpis.distinctProducts) },
        ],
        filename: "الأكثر-ربحية",
        orientation: "landscape",
      });
    } else if (view === "by-category") {
      await exportReportPdf({
        title: "المبيعات حسب التصنيف",
        settings,
        headers: [
          "التصنيف",
          "المنتجات",
          "الكمية",
          "الإيرادات",
          "التكلفة",
          "الربح",
        ],
        rows: categoryList.map((c) => [
          c.name,
          c.productCount,
          fmtN(c.netQty),
          fmt(c.netRevenue),
          fmt(c.netCogs),
          fmt(c.profit),
        ]),
        summaryCards: [
          { label: "عدد التصنيفات", value: fmtN(categoryList.length) },
          {
            label: "إجمالي الإيرادات",
            value: `${fmt(kpis.totalNetRevenue)} ${currency}`,
          },
          {
            label: "إجمالي الربح",
            value: `${fmt(kpis.totalProfit)} ${currency}`,
          },
          { label: "متوسط الهامش", value: fmtPct(kpis.overallMargin) },
        ],
        filename: "مبيعات-بالتصنيف",
      });
    } else if (view === "turnover") {
      await exportReportPdf({
        title: "دوران المخزون",
        settings,
        headers: [
          "الكود",
          "المنتج",
          "التصنيف",
          "ت.المبيعات",
          "ق.المخزون",
          "الدوران",
          "أيام التغطية",
          "المخزون",
          "التقييم",
        ],
        rows: turnoverData.map((p) => [
          p.code,
          p.name,
          p.category,
          fmt(p.cogs),
          fmt(p.avgInventory),
          p.turnover > 0 ? String(p.turnover) : "—",
          p.daysOfSupply != null ? fmtN(p.daysOfSupply) : "—",
          fmtN(p.currentStock),
          TURNOVER_LABELS[p.rating],
        ]),
        summaryCards: [
          {
            label: "ممتاز الدوران",
            value: fmtN(
              turnoverData.filter((p) => p.rating === "excellent").length,
            ),
          },
          { label: "منتجات راكدة", value: fmtN(deadStockItems.length) },
          { label: "قيمة الراكد", value: `${fmt(deadStockValue)} ${currency}` },
          { label: "تحت الاختبار", value: fmtN(newProductsCount) },
        ],
        filename: "دوران-المخزون",
        orientation: "landscape",
      });
    } else if (view === "abc") {
      await exportReportPdf({
        title: "تحليل ABC - قاعدة باريتو",
        settings,
        headers: [
          "الكود",
          "المنتج",
          "التصنيف",
          "الكمية",
          "الإيرادات",
          "الحصة %",
          "التراكمي %",
          "ABC",
        ],
        rows: abcData.map((p) => [
          p.code,
          p.name,
          p.category,
          fmtN(p.netQty),
          fmt(p.netRevenue),
          fmtPct(p.revenueShare),
          fmtPct(p.cumulative),
          p.abcClass,
        ]),
        summaryCards: [
          { label: "فئة A (نجوم)", value: `${fmtN(abcKpis.countA)} منتج` },
          { label: "حصة A من الإيراد", value: fmtPct(abcKpis.aRevenuePct) },
          { label: "فئة B", value: `${fmtN(abcKpis.countB)} منتج` },
          { label: "فئة C (ذيل)", value: `${fmtN(abcKpis.countC)} منتج` },
        ],
        filename: "تحليل-ABC",
        orientation: "landscape",
      });
    } else {
      await exportReportPdf({
        title: "تحليل المرتجعات",
        settings,
        headers: [
          "الكود",
          "المنتج",
          "التصنيف",
          "مباع",
          "مرتجع",
          "معدل الإرجاع %",
          "قيمة المرتجعات",
          "أثر على الربح",
        ],
        rows: returnMetrics.map((p) => [
          p.code,
          p.name,
          p.category,
          fmtN(p.soldQty),
          fmtN(p.returnedQty),
          fmtPct(p.returnRate),
          fmt(p.returnsValue),
          fmt(p.profitImpact),
        ]),
        summaryCards: [
          {
            label: "معدل الإرجاع الكلي",
            value: fmtPct(returnKpis.overallRate),
          },
          {
            label: "إجمالي قيمة المرتجعات",
            value: `${fmt(returnKpis.totalValue)} ${currency}`,
          },
          {
            label: "منتجات معدل >30%",
            value: fmtN(returnKpis.highRateProducts),
          },
          {
            label: "أعلى منتج",
            value: returnKpis.worstProduct?.name.slice(0, 20) ?? "—",
          },
        ],
        filename: "تحليل-المرتجعات",
        orientation: "landscape",
      });
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 p-1">
      {/* ── Filter Bar ─────────────────────────────────────────────────────── */}
      <Card className="border shadow-sm">
        <CardContent className="py-3 px-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
            {(["1", "3", "6", "12"] as QuickRange[]).map((q) => (
              <Button
                key={q}
                variant={quickRange === q ? "default" : "outline"}
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => applyQuickRange(q)}
              >
                {q === "1" ? "شهر" : q === "12" ? "سنة" : `${q} أشهر`}
              </Button>
            ))}
            <Separator orientation="vertical" className="h-6 hidden md:block" />
            <DatePickerInput
              value={dateFrom}
              onChange={(v) => {
                setDateFrom(v);
                setQuickRange("custom");
              }}
              placeholder="من"
              className="w-[136px]"
            />
            <span className="text-muted-foreground/40">—</span>
            <DatePickerInput
              value={dateTo}
              onChange={(v) => {
                setDateTo(v);
                setQuickRange("custom");
              }}
              placeholder="إلى"
              className="w-[136px]"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Select value={view} onValueChange={(v: ViewType) => setView(v)}>
                <SelectTrigger className="w-[190px] font-medium h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="top-sellers">الأكثر مبيعاً</SelectItem>
                  <SelectItem value="most-profitable">الأكثر ربحية</SelectItem>
                  <SelectItem value="by-category">حسب التصنيف</SelectItem>
                  <SelectItem value="turnover">دوران المخزون</SelectItem>
                  <SelectItem value="abc">تحليل ABC</SelectItem>
                  <SelectItem value="returns">تحليل المرتجعات</SelectItem>
                </SelectContent>
              </Select>
              <CategoryTreeSelect
                categories={categories ?? []}
                value={categoryFilter === "all" ? "" : categoryFilter}
                onValueChange={(id) => setCategoryFilter(id || "all")}
                placeholder="جميع التصنيفات"
                className="w-[170px]"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={isLoading}
                className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300 dark:text-emerald-400 dark:border-emerald-900 dark:hover:bg-emerald-950"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePdfExport}
                disabled={isLoading}
                className="gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50 hover:border-rose-300 dark:text-rose-400 dark:border-rose-900 dark:hover:bg-rose-950"
              >
                <FileText className="w-4 h-4" />
                PDF
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── View Description ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-1">
        {VIEW_INFO[view].icon}
        <p className="text-sm text-muted-foreground">{VIEW_INFO[view].desc}</p>
      </div>

      {/* ── Contextual KPI Cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {view === "top-sellers" && (
          <>
            <KpiCard
              icon={<Package className="w-5 h-5 text-primary" />}
              color="primary"
              label="أصناف مباعة"
              value={isLoading ? null : fmtN(kpis.distinctProducts)}
            />
            <KpiCard
              icon={<ShoppingCart className="w-5 h-5 text-blue-500" />}
              color="blue"
              label="صافي الكميات"
              value={isLoading ? null : fmtN(kpis.totalNetQty)}
            />
            <KpiCard
              icon={<TrendingUp className="w-5 h-5 text-emerald-600" />}
              color="emerald"
              label="صافي الإيرادات"
              value={isLoading ? null : fmt(kpis.totalNetRevenue)}
            />
            <KpiCard
              icon={<RotateCcw className="w-5 h-5 text-rose-500" />}
              color="rose"
              label="معدل المرتجعات"
              value={isLoading ? null : fmtPct(kpis.overallReturnRate)}
            />
          </>
        )}
        {view === "most-profitable" && (
          <>
            <KpiCard
              icon={<DollarSign className="w-5 h-5 text-emerald-600" />}
              color="emerald"
              label="إجمالي الربح"
              value={isLoading ? null : fmt(kpis.totalProfit)}
              isProfit
              profit={kpis.totalProfit}
            />
            <KpiCard
              icon={<TrendingUp className="w-5 h-5 text-blue-500" />}
              color="blue"
              label="متوسط هامش الربح"
              value={isLoading ? null : fmtPct(kpis.overallMargin)}
            />
            <KpiCard
              icon={<Star className="w-5 h-5 text-yellow-500" />}
              color="amber"
              label="أعلى هامش"
              value={isLoading ? null : fmtPct(kpis.topMargin)}
            />
            <KpiCard
              icon={<Package className="w-5 h-5 text-primary" />}
              color="primary"
              label="عدد المنتجات"
              value={isLoading ? null : fmtN(kpis.distinctProducts)}
            />
          </>
        )}
        {view === "by-category" && (
          <>
            <KpiCard
              icon={<Layers className="w-5 h-5 text-blue-600" />}
              color="blue"
              label="عدد التصنيفات"
              value={isLoading ? null : fmtN(categoryList.length)}
            />
            <KpiCard
              icon={<TrendingUp className="w-5 h-5 text-emerald-600" />}
              color="emerald"
              label="إجمالي الإيرادات"
              value={isLoading ? null : fmt(kpis.totalNetRevenue)}
            />
            <KpiCard
              icon={<DollarSign className="w-5 h-5 text-primary" />}
              color="primary"
              label="إجمالي الربح"
              value={isLoading ? null : fmt(kpis.totalProfit)}
              isProfit
              profit={kpis.totalProfit}
            />
            <KpiCard
              icon={<Star className="w-5 h-5 text-amber-500" />}
              color="amber"
              label="متوسط هامش التصنيف"
              value={isLoading ? null : fmtPct(kpis.overallMargin)}
            />
          </>
        )}
        {view === "turnover" && (
          <>
            <KpiCard
              icon={<Zap className="w-5 h-5 text-emerald-600" />}
              color="emerald"
              label="ممتاز الدوران"
              value={
                isLoading
                  ? null
                  : fmtN(
                      turnoverData.filter((p) => p.rating === "excellent")
                        .length,
                    )
              }
            />
            <KpiCard
              icon={<Package className="w-5 h-5 text-blue-500" />}
              color="blue"
              label="تحت الاختبار"
              value={isLoading ? null : fmtN(newProductsCount)}
            />
            <KpiCard
              icon={<AlertTriangle className="w-5 h-5 text-destructive" />}
              color="rose"
              label="منتجات راكدة"
              value={isLoading ? null : fmtN(deadStockItems.length)}
            />
            <KpiCard
              icon={<DollarSign className="w-5 h-5 text-rose-600" />}
              color="rose"
              label="قيمة الراكد"
              value={isLoading ? null : fmt(deadStockValue)}
            />
          </>
        )}
        {view === "abc" && (
          <>
            <KpiCard
              icon={<Star className="w-5 h-5 text-emerald-600" />}
              color="emerald"
              label="فئة A (نجوم 70%)"
              value={isLoading ? null : fmtN(abcKpis.countA)}
            />
            <KpiCard
              icon={<TrendingUp className="w-5 h-5 text-blue-500" />}
              color="blue"
              label="حصة A من الإيراد"
              value={isLoading ? null : fmtPct(abcKpis.aRevenuePct)}
            />
            <KpiCard
              icon={<Layers className="w-5 h-5 text-slate-500" />}
              color="primary"
              label="فئة B"
              value={isLoading ? null : fmtN(abcKpis.countB)}
            />
            <KpiCard
              icon={<Package className="w-5 h-5 text-slate-400" />}
              color="amber"
              label="فئة C (الذيل)"
              value={isLoading ? null : fmtN(abcKpis.countC)}
            />
          </>
        )}
        {view === "returns" && (
          <>
            <KpiCard
              icon={<RotateCcw className="w-5 h-5 text-rose-500" />}
              color="rose"
              label="معدل الإرجاع الكلي"
              value={isLoading ? null : fmtPct(returnKpis.overallRate)}
            />
            <KpiCard
              icon={<DollarSign className="w-5 h-5 text-rose-600" />}
              color="rose"
              label="قيمة المرتجعات"
              value={isLoading ? null : fmt(returnKpis.totalValue)}
            />
            <KpiCard
              icon={<AlertTriangle className="w-5 h-5 text-destructive" />}
              color="rose"
              label="معدل >30%"
              value={isLoading ? null : fmtN(returnKpis.highRateProducts)}
            />
            <KpiCard
              icon={<TrendingDown className="w-5 h-5 text-rose-500" />}
              color="rose"
              label="أثر على الربح"
              value={
                isLoading
                  ? null
                  : fmt(returnMetrics.reduce((s, p) => s + p.profitImpact, 0))
              }
            />
          </>
        )}
      </div>

      {/* ── Alerts ─────────────────────────────────────────────────────────── */}
      {(view === "turnover" || view === "returns") && !isLoading && (
        <div className="space-y-2">
          {view === "turnover" && deadStockItems.length > 0 && (
            <Alert
              variant="destructive"
              className="border-destructive/40 bg-destructive/5"
            >
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>{fmtN(deadStockItems.length)}</strong> منتج راكد دون
                مبيعات في الفترة — قيمة مخزون محتجز:{" "}
                <strong>{fmt(deadStockValue)}</strong> — راجع التسعير أو اتخذ
                قرار تخفيض/إرجاع
              </AlertDescription>
            </Alert>
          )}
          {view === "turnover" && newProductsCount > 0 && (
            <Alert className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30">
              <Info className="h-4 w-4 text-blue-500" />
              <AlertDescription className="text-sm text-blue-800 dark:text-blue-300">
                <strong>{newProductsCount}</strong> منتج تحت الاختبار (أول شراء
                خلال آخر {NEW_PRODUCT_THRESHOLD_DAYS} يوم) — لا تُعدّ راكدة بل
                في مرحلة التجربة
              </AlertDescription>
            </Alert>
          )}
          {view === "turnover" && reorderAlerts.length > 0 && (
            <Alert className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30">
              <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertDescription className="text-sm text-amber-800 dark:text-amber-300">
                <strong>{reorderAlerts.length}</strong> منتج تحت نقطة إعادة
                الطلب:{" "}
                {reorderAlerts
                  .slice(0, 3)
                  .map((p) => p.name)
                  .join("، ")}
                {reorderAlerts.length > 3
                  ? ` و${reorderAlerts.length - 3} آخرين`
                  : ""}
              </AlertDescription>
            </Alert>
          )}
          {view === "returns" && returnKpis.highRateProducts > 0 && (
            <Alert
              variant="destructive"
              className="border-destructive/40 bg-destructive/5"
            >
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>{returnKpis.highRateProducts}</strong> منتج بمعدل إرجاع
                يتجاوز 30% — راجع جودتها ووصفها البيعي
              </AlertDescription>
            </Alert>
          )}
          {view === "returns" &&
            kpis.totalNetRevenue > 0 &&
            (kpis.totalReturnsValue / kpis.totalNetRevenue) * 100 > 10 && (
              <Alert className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30">
                <Info className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-sm text-amber-800 dark:text-amber-300">
                  إجمالي المرتجعات يمثل{" "}
                  <strong>
                    {fmtPct(
                      (kpis.totalReturnsValue / kpis.totalNetRevenue) * 100,
                    )}
                  </strong>{" "}
                  من الإيرادات — مستوى مرتفع يؤثر على صافي الربح
                </AlertDescription>
              </Alert>
            )}
        </div>
      )}

      {/* ── Charts ─────────────────────────────────────────────────────────── */}
      {(view === "top-sellers" || view === "most-profitable") &&
        chartData.length > 0 && (
          <Card className="border shadow-sm">
            <CardHeader className="pb-1 pt-4 px-5">
              <CardTitle className="text-sm font-semibold text-foreground/80">
                {view === "top-sellers" ? "الأكثر مبيعاً" : "الأكثر ربحية"}
                <span className="ms-1.5 text-xs font-normal text-muted-foreground">
                  (أعلى 10)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3">
              {isLoading ? (
                <Skeleton className="h-[260px] w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ left: 4, right: 16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                    <XAxis
                      type="number"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={120}
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      formatter={(v: number) =>
                        view === "top-sellers" ? fmtN(v) : fmt(v)
                      }
                      contentStyle={{ borderRadius: 8, fontSize: 12 }}
                    />
                    <Bar
                      dataKey="value"
                      name={view === "top-sellers" ? "صافي الكمية" : "الربح"}
                      fill={
                        view === "top-sellers"
                          ? "hsl(217, 80%, 50%)"
                          : "hsl(152, 60%, 42%)"
                      }
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
            <CardTitle className="text-sm font-semibold text-foreground/80">
              توزيع الإيرادات حسب التصنيف
            </CardTitle>
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
                    label={({ name, percent }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                    fontSize={11}
                    paddingAngle={2}
                  >
                    {categoryChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => fmt(v)}
                    contentStyle={{ borderRadius: 8, fontSize: 12 }}
                  />
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
              <CardTitle className="text-sm font-semibold text-foreground/80">
                توزيع فئات دوران المخزون
              </CardTitle>
              <TooltipProvider>
                <UITooltip>
                  <TooltipTrigger>
                    <Info className="w-3.5 h-3.5 text-muted-foreground/60 hover:text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs text-xs">
                    ممتاز: دوران &gt;2 — متوسط: 0.5–2 — بطيء: &lt;0.5 — راكد: لم
                    يُبع — تحت الاختبار: أول شراء حديث
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

      {view === "abc" && abcChartData.length > 0 && (
        <Card className="border shadow-sm">
          <CardHeader className="pb-1 pt-4 px-5">
            <CardTitle className="text-sm font-semibold text-foreground/80">
              توزيع فئات ABC
              <span className="ms-1.5 text-xs font-normal text-muted-foreground">
                — العدد والإيراد
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={abcChartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      label={({ name, value }) => `${name}: ${value}`}
                      fontSize={11}
                      paddingAngle={3}
                    >
                      {abcChartData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => `${v} منتج`}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={abcChartData}
                    margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                    <XAxis dataKey="name" fontSize={11} tickLine={false} />
                    <YAxis fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip
                      formatter={(v: number) => fmt(v)}
                      contentStyle={{ borderRadius: 8, fontSize: 12 }}
                    />
                    <Bar
                      dataKey="revenue"
                      name="الإيراد"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                    >
                      {abcChartData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {view === "returns" && returnMetrics.some((p) => p.returnedQty > 0) && (
        <Card className="border shadow-sm">
          <CardHeader className="pb-1 pt-4 px-5">
            <CardTitle className="text-sm font-semibold text-foreground/80">
              أعلى المنتجات معدل إرجاع
              <span className="ms-1.5 text-xs font-normal text-muted-foreground">
                (أعلى 10)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3">
            {isLoading ? (
              <Skeleton className="h-[220px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={returnMetrics
                    .filter((p) => p.returnedQty > 0)
                    .slice(0, 10)
                    .map((p) => ({
                      name:
                        p.name.length > 15 ? p.name.slice(0, 15) + "…" : p.name,
                      value: p.returnRate,
                    }))}
                  layout="vertical"
                  margin={{ left: 4, right: 16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                  <XAxis
                    type="number"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={120}
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    formatter={(v: number) => `${v.toFixed(1)}%`}
                    contentStyle={{ borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar
                    dataKey="value"
                    name="معدل الإرجاع %"
                    fill="hsl(0, 72%, 51%)"
                    radius={[0, 6, 6, 0]}
                    maxBarSize={18}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Data Tables ────────────────────────────────────────────────────── */}
      {view === "top-sellers" && (
        <DataTable
          columns={topSellersColumns}
          data={topSellers}
          isLoading={isLoading}
          showSearch
          showColumnToggle
          showPagination
          pageSize={20}
          searchPlaceholder="بحث بالاسم أو الكود..."
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
            returnRate: "معدل الإرجاع",
            margin: "هامش الربح",
          }}
        />
      )}
      {view === "most-profitable" && (
        <DataTable
          columns={mostProfitableColumns}
          data={mostProfitable}
          isLoading={isLoading}
          showSearch
          showColumnToggle
          showPagination
          pageSize={20}
          searchPlaceholder="بحث بالاسم أو الكود..."
          emptyMessage="لا توجد بيانات"
          columnLabels={{
            rank: "#",
            code: "الكود",
            name: "المنتج",
            category: "التصنيف",
            netRevenue: "الإيرادات",
            netCogs: "التكلفة",
            profit: "الربح",
            margin: "هامش الربح",
            profitPerUnit: "ربح/وحدة",
            avgPrice: "متوسط البيع",
          }}
        />
      )}
      {view === "by-category" && (
        <DataTable
          columns={categoryColumns}
          data={categoryList}
          isLoading={isLoading}
          showSearch
          showColumnToggle
          showPagination
          pageSize={20}
          searchPlaceholder="بحث بالتصنيف..."
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
          showSearch
          showColumnToggle
          showPagination
          pageSize={20}
          searchPlaceholder="بحث بالاسم أو الكود..."
          emptyMessage="لا توجد بيانات"
          columnLabels={{
            code: "الكود",
            name: "المنتج",
            category: "التصنيف",
            cogs: "تكلفة المبيعات",
            avgInventory: "قيمة المخزون",
            turnover: "معدل الدوران",
            daysOfSupply: "أيام التغطية",
            currentStock: "المخزون",
            rating: "التقييم",
          }}
        />
      )}
      {view === "abc" && (
        <DataTable
          columns={abcColumns}
          data={abcData}
          isLoading={isLoading}
          showSearch
          showColumnToggle
          showPagination
          pageSize={20}
          searchPlaceholder="بحث بالاسم أو الكود..."
          emptyMessage="لا توجد بيانات كافية"
          columnLabels={{
            rank: "#",
            code: "الكود",
            name: "المنتج",
            category: "التصنيف",
            netQty: "الكمية",
            netRevenue: "الإيرادات",
            revenueShare: "الحصة %",
            cumulative: "التراكمي %",
            abcClass: "التصنيف ABC",
          }}
        />
      )}
      {view === "returns" && (
        <DataTable
          columns={returnColumns}
          data={returnMetrics}
          isLoading={isLoading}
          showSearch
          showColumnToggle
          showPagination
          pageSize={20}
          searchPlaceholder="بحث بالاسم أو الكود..."
          emptyMessage="لا توجد مرتجعات في هذه الفترة"
          columnLabels={{
            rank: "#",
            code: "الكود",
            name: "المنتج",
            category: "التصنيف",
            soldQty: "مباع",
            returnedQty: "مرتجع",
            returnRate: "معدل الإرجاع %",
            returnsValue: "قيمة المرتجعات",
            profitImpact: "أثر على الربح",
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI Card sub-component
// ─────────────────────────────────────────────────────────────────────────────
function KpiCard({
  icon,
  color,
  label,
  value,
  isProfit = false,
  profit = 0,
}: {
  icon: JSX.Element;
  color: "primary" | "blue" | "emerald" | "rose" | "amber";
  label: string;
  value: string | null;
  isProfit?: boolean;
  profit?: number;
}) {
  const bgMap = {
    primary: "from-primary/5",
    blue: "from-blue-500/5",
    emerald: "from-emerald-500/5",
    rose: "from-rose-500/5",
    amber: "from-amber-500/5",
  };
  const iconBgMap = {
    primary: "bg-primary/10",
    blue: "bg-blue-500/10",
    emerald: "bg-emerald-500/10",
    rose: "bg-rose-500/10",
    amber: "bg-amber-500/10",
  };
  let valueClass =
    "text-2xl font-extrabold tracking-tight tabular-nums truncate";
  if (isProfit)
    valueClass +=
      profit >= 0
        ? " text-emerald-600 dark:text-emerald-400"
        : " text-destructive";
  return (
    <Card className="relative overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
      <div
        className={`absolute inset-0 bg-gradient-to-br ${bgMap[color]} via-transparent to-transparent pointer-events-none`}
      />
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div
            className={`w-11 h-11 rounded-2xl ${iconBgMap[color]} flex items-center justify-center shrink-0 shadow-inner`}
          >
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground mb-1">
              {label}
            </p>
            {value === null ? (
              <Skeleton className="h-7 w-20" />
            ) : (
              <p className={valueClass}>{value}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
