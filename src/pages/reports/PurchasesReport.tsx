import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getQuickDateRanges, getPreviousPeriod } from "@/lib/report-period";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ColumnDef, SortingState } from "@tanstack/react-table";
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
  PieChart,
  Pie,
  Cell,
  Line,
  ComposedChart,
  Legend,
} from "recharts";
import { useSettings } from "@/contexts/SettingsContext";
import {
  ReceiptText,
  DollarSign,
  ArrowDownLeft,
  TrendingUp,
  TrendingDown,
  Percent,
  AlertTriangle,
  ShoppingCart,
  ArrowUp,
  ArrowDown,
  Lightbulb,
  Users,
  Package,
  Target,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDisplayNumber } from "@/lib/posted-number-utils";

const fmt = (n: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const CHART_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#f97316",
  "#ec4899",
  "#a855f7",
  "#eab308",
];

export default function PurchasesReport() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [dateFrom, setDateFrom] = useState(
    format(startOfMonth(new Date()), "yyyy-MM-dd"),
  );
  const [dateTo, setDateTo] = useState(
    format(endOfMonth(new Date()), "yyyy-MM-dd"),
  );
  const [statusFilter, setStatusFilter] = useState<
    "all" | "posted" | "draft" | "cancelled"
  >("posted");
  const [groupBy, setGroupBy] = useState<
    "invoice" | "supplier" | "product" | "time" | "category"
  >("invoice");
  const [timeMode, setTimeMode] = useState<"daily" | "monthly">("daily");

  // ── Sorting states per grouping ──
  const [supplierSort, setSupplierSort] = useState<SortingState>([]);
  const [productSort, setProductSort] = useState<SortingState>([]);
  const [categorySort, setCategorySort] = useState<SortingState>([]);
  const [timeSort, setTimeSort] = useState<SortingState>([]);

  // ── Generic quick-sort toolbar ──
  const QuickSortToolbar = ({
    sorting,
    setSorting,
    buttons,
  }: {
    sorting: SortingState;
    setSorting: (s: SortingState) => void;
    buttons: { id: string; label: string }[];
  }) => {
    const active = sorting[0];
    const toggle = (id: string) => {
      if (active?.id !== id) setSorting([{ id, desc: true }]);
      else if (active.desc) setSorting([{ id, desc: false }]);
      else setSorting([]);
    };
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {buttons.map((b) => {
          const isActive = active?.id === b.id;
          const Icon = isActive && !active.desc ? ArrowUp : ArrowDown;
          return (
            <Button
              key={b.id}
              variant={isActive ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() => toggle(b.id)}
            >
              <Icon className="h-3 w-3" />
              {b.label}
            </Button>
          );
        })}
      </div>
    );
  };

  // ── Quick date presets (طبقة مشتركة) ──
  const quickRanges = useMemo(() => getQuickDateRanges(), []);

  // ── Previous period calculation (طبقة مشتركة) ──
  const prevPeriod = useMemo(
    () => getPreviousPeriod(dateFrom, dateTo),
    [dateFrom, dateTo],
  );

  const calcGrowth = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / Math.abs(previous)) * 100;
  };

  // ── Query 1: Invoices ──
  const { data: invoices = [], isLoading: loadingInv } = useQuery({
    queryKey: ["pr-invoices", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_invoices")
        .select(
          "id, invoice_number, invoice_date, due_date, status, subtotal, discount, tax, total, paid_amount, supplier_id, posted_number, supplier:suppliers(name), items:purchase_invoice_items(quantity, total, net_total, product_id, product:products(name, category_id, category:product_categories(name)))",
        )
        .gte("invoice_date", dateFrom)
        .lte("invoice_date", dateTo)
        .order("invoice_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  // ── Query 2: Returns ──
  const { data: returns = [] } = useQuery({
    queryKey: ["pr-returns", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_returns")
        .select(
          "id, return_date, total, status, supplier_id, supplier:suppliers(name), items:purchase_return_items(quantity, total, product_id, product:products(category_id, category:product_categories(name)))",
        )
        .eq("status", "posted")
        .gte("return_date", dateFrom)
        .lte("return_date", dateTo);
      if (error) throw error;
      return data as any[];
    },
  });

  // ── Query 3: Inventory movements ──
  const { data: movements = [] } = useQuery({
    queryKey: ["pr-movements", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select(
          "product_id, movement_type, quantity, total_cost, movement_date",
        )
        .in("movement_type", ["purchase", "purchase_return"])
        .gte("movement_date", dateFrom)
        .lte("movement_date", dateTo);
      if (error) throw error;
      return data as any[];
    },
  });

  // ── Query 4: Previous period (for comparison) ──
  const { data: prevInvoices = [] } = useQuery({
    queryKey: ["pr-prev-invoices", prevPeriod.from, prevPeriod.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_invoices")
        .select("total")
        .eq("status", "posted")
        .gte("invoice_date", prevPeriod.from)
        .lte("invoice_date", prevPeriod.to);
      if (error) throw error;
      return data as any[];
    },
  });
  const { data: prevReturns = [] } = useQuery({
    queryKey: ["pr-prev-returns", prevPeriod.from, prevPeriod.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_returns")
        .select("total")
        .eq("status", "posted")
        .gte("return_date", prevPeriod.from)
        .lte("return_date", prevPeriod.to);
      if (error) throw error;
      return data as any[];
    },
  });

  // ── Filtered invoices ──
  const filtered = useMemo(() => {
    if (statusFilter === "all") return invoices;
    return invoices.filter((inv) => inv.status === statusFilter);
  }, [invoices, statusFilter]);

  // ── KPI summary (always from posted invoices) ──
  const kpi = useMemo(() => {
    const posted = invoices.filter((i) => i.status === "posted");
    const grossPurchases = posted.reduce((s, i) => s + Number(i.total), 0);
    const paid = posted.reduce((s, i) => s + Number(i.paid_amount), 0);
    const returnsTotal = returns.reduce((s, r) => s + Number(r.total), 0);
    const netPurchases = grossPurchases - returnsTotal;
    const paymentRate = netPurchases > 0 ? (paid / netPurchases) * 100 : 0;
    return {
      count: posted.length,
      grossPurchases,
      returnsTotal,
      netPurchases,
      paid,
      paymentRate: Math.min(paymentRate, 100),
    };
  }, [invoices, returns]);

  // ── Previous period KPIs ──
  const prevKpi = useMemo(() => {
    const grossPurchases = prevInvoices.reduce(
      (s, i) => s + Number(i.total),
      0,
    );
    const returnsTotal = prevReturns.reduce((s, r) => s + Number(r.total), 0);
    return {
      count: prevInvoices.length,
      grossPurchases,
      netPurchases: grossPurchases - returnsTotal,
    };
  }, [prevInvoices, prevReturns]);

  const GrowthBadge = ({
    current,
    previous,
  }: {
    current: number;
    previous: number;
  }) => {
    if (isLoading) return null;
    const g = calcGrowth(current, previous);
    if (previous === 0 && current === 0) return null;
    return (
      <span
        className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${g <= 0 ? "text-emerald-600" : "text-amber-600"}`}
      >
        {g >= 0 ? (
          <TrendingUp className="w-3 h-3" />
        ) : (
          <TrendingDown className="w-3 h-3" />
        )}
        {g >= 0 ? "+" : ""}
        {g.toFixed(1)}%
      </span>
    );
  };

  // ── Returns map by supplier ──
  const returnsBySupplier = useMemo(() => {
    const map: Record<string, number> = {};
    returns.forEach((r) => {
      const sid = r.supplier_id || "__none__";
      map[sid] = (map[sid] || 0) + Number(r.total);
    });
    return map;
  }, [returns]);

  // ── Returns map by product ──
  const returnsByProduct = useMemo(() => {
    const map: Record<string, { qty: number; total: number }> = {};
    returns.forEach((r) => {
      (r.items || []).forEach((item: any) => {
        const pid = item.product_id || "__none__";
        if (!map[pid]) map[pid] = { qty: 0, total: 0 };
        map[pid].qty += Number(item.quantity);
        map[pid].total += Number(item.total);
      });
    });
    return map;
  }, [returns]);

  // ── Returns map by date ──
  const returnsByDate = useMemo(() => {
    const map: Record<string, number> = {};
    returns.forEach((r) => {
      const key =
        timeMode === "daily" ? r.return_date : r.return_date?.substring(0, 7);
      map[key] = (map[key] || 0) + Number(r.total);
    });
    return map;
  }, [returns, timeMode]);

  // ── Overdue check ──
  const today = format(new Date(), "yyyy-MM-dd");
  const isOverdue = (inv: any) =>
    inv.due_date &&
    inv.due_date < today &&
    Number(inv.total) - Number(inv.paid_amount) > 0;

  const overdueInfo = useMemo(() => {
    const posted = invoices.filter((i) => i.status === "posted");
    const ov = posted.filter(isOverdue);
    return {
      count: ov.length,
      total: ov.reduce(
        (s, i) => s + Number(i.total) - Number(i.paid_amount),
        0,
      ),
    };
  }, [invoices]);

  const discountTaxInfo = useMemo(() => {
    const posted = invoices.filter((i) => i.status === "posted");
    return {
      discount: posted.reduce((s, i) => s + Number(i.discount || 0), 0),
      tax: posted.reduce((s, i) => s + Number(i.tax || 0), 0),
    };
  }, [invoices]);

  // ═══ GROUPING: By Invoice ═══
  const invoiceColumns = useMemo<ColumnDef<any, any>[]>(
    () => [
      {
        accessorKey: "invoice_number",
        header: "رقم الفاتورة",
        cell: ({ row }) => {
          const inv = row.original;
          const display = formatDisplayNumber(
            settings?.purchase_invoice_prefix || "PUR-",
            inv.posted_number,
            inv.invoice_number,
            inv.status,
          );
          return (
            <button
              className="text-primary hover:underline font-mono font-medium"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/purchases/${inv.id}`);
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
        id: "supplier",
        header: "المورد",
        accessorFn: (row: any) => row.supplier?.name || "بدون مورد",
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
        accessorFn: (r: any) => Number(r.total),
        cell: ({ getValue }) => fmt(getValue() as number),
        footer: ({ table }) => {
          const total = table
            .getFilteredRowModel()
            .rows.reduce((s, r) => s + Number(r.original.total), 0);
          return <span className="font-bold font-mono">{fmt(total)}</span>;
        },
      },
      {
        id: "paid",
        header: "المدفوع",
        accessorFn: (r: any) => Number(r.paid_amount),
        cell: ({ getValue }) => fmt(getValue() as number),
        footer: ({ table }) => {
          const total = table
            .getFilteredRowModel()
            .rows.reduce((s, r) => s + Number(r.original.paid_amount), 0);
          return <span className="font-mono">{fmt(total)}</span>;
        },
      },
      {
        id: "remaining",
        header: "المتبقي",
        accessorFn: (r: any) => Number(r.total) - Number(r.paid_amount),
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <span className={v > 0 ? "text-destructive font-medium" : ""}>
              {fmt(v)}
            </span>
          );
        },
        footer: ({ table }) => {
          const total = table
            .getFilteredRowModel()
            .rows.reduce(
              (s, r) =>
                s + Number(r.original.total) - Number(r.original.paid_amount),
              0,
            );
          return (
            <span className="font-mono text-destructive">{fmt(total)}</span>
          );
        },
      },
      {
        id: "overdue",
        header: "متأخر",
        cell: ({ row }) =>
          isOverdue(row.original) ? (
            <Badge variant="destructive" className="text-[10px] px-1.5">
              <AlertTriangle className="w-3 h-3 ml-0.5" />
              متأخر
            </Badge>
          ) : null,
      },
    ],
    [navigate, today, settings],
  );

  // ═══ GROUPING: By Supplier ═══
  const supplierData = useMemo(() => {
    const map: Record<
      string,
      {
        id: string;
        name: string;
        count: number;
        total: number;
        paid: number;
        returns: number;
      }
    > = {};
    filtered.forEach((inv) => {
      const sid = inv.supplier_id || "__none__";
      const name = inv.supplier?.name || "بدون مورد";
      if (!map[sid])
        map[sid] = { id: sid, name, count: 0, total: 0, paid: 0, returns: 0 };
      map[sid].count++;
      map[sid].total += Number(inv.total);
      map[sid].paid += Number(inv.paid_amount);
    });
    Object.keys(map).forEach((sid) => {
      map[sid].returns = returnsBySupplier[sid] || 0;
    });
    const grandTotal = Object.values(map).reduce((s, c) => s + c.total, 0);
    return Object.values(map)
      .map((c) => {
        const net = c.total - c.returns;
        return {
          ...c,
          net,
          remaining: c.total - c.paid,
          avgInvoice: c.count > 0 ? c.total / c.count : 0,
          pctOfTotal: grandTotal > 0 ? (c.total / grandTotal) * 100 : 0,
          returnRate: c.total > 0 ? (c.returns / c.total) * 100 : 0,
          paymentRate: net > 0 ? Math.min((c.paid / net) * 100, 100) : 0,
        };
      })
      .sort((a, b) => b.net - a.net);
  }, [filtered, returnsBySupplier]);

  const supplierColumns = useMemo<ColumnDef<any, any>[]>(
    () => [
      {
        accessorKey: "name",
        header: "المورد",
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex items-center gap-2">
              <span className="font-medium">{r.name}</span>
              {r.pctOfTotal >= 40 && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                  <AlertTriangle className="w-2.5 h-2.5 ml-0.5" />
                  اعتماد مفرط
                </Badge>
              )}
            </div>
          );
        },
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
        header: "الإجمالي",
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
        accessorKey: "net",
        header: "الصافي",
        cell: ({ getValue }) => (
          <span className="font-bold">{fmt(getValue() as number)}</span>
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
        accessorKey: "pctOfTotal",
        header: "حصة %",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          const color =
            v >= 40
              ? "text-destructive"
              : v >= 25
                ? "text-amber-600"
                : "text-muted-foreground";
          return (
            <span className={`font-mono font-semibold ${color}`}>
              {v.toFixed(1)}%
            </span>
          );
        },
      },
      {
        accessorKey: "returnRate",
        header: "معدل الإرجاع",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          const color =
            v >= 10
              ? "text-destructive"
              : v >= 5
                ? "text-amber-600"
                : "text-emerald-600";
          return (
            <span className={`font-mono ${color}`}>{v.toFixed(1)}%</span>
          );
        },
      },
      {
        accessorKey: "avgInvoice",
        header: "متوسط الفاتورة",
        cell: ({ getValue }) => (
          <span className="font-mono text-muted-foreground">
            {fmt(getValue() as number)}
          </span>
        ),
      },
      {
        accessorKey: "remaining",
        header: "المتبقي",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <span className={v > 0 ? "text-destructive" : ""}>{fmt(v)}</span>
          );
        },
        footer: ({ table }) => {
          const t = table
            .getFilteredRowModel()
            .rows.reduce((s, r) => s + r.original.remaining, 0);
          return <span className="text-destructive font-mono">{fmt(t)}</span>;
        },
      },
      {
        accessorKey: "paymentRate",
        header: "السداد%",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          const color =
            v >= 80
              ? "text-emerald-600"
              : v >= 50
                ? "text-amber-600"
                : "text-destructive";
          return (
            <div className="flex items-center gap-1.5 min-w-[80px]">
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${
                    v >= 80
                      ? "bg-emerald-500"
                      : v >= 50
                        ? "bg-amber-500"
                        : "bg-destructive"
                  }`}
                  style={{ width: `${v}%` }}
                />
              </div>
              <span className={`font-mono text-xs ${color}`}>
                {v.toFixed(0)}%
              </span>
            </div>
          );
        },
      },
    ],
    [],
  );


  // ═══ GROUPING: By Product ═══
  const productData = useMemo(() => {
    const map: Record<
      string,
      {
        name: string;
        qtyPurchased: number;
        qtyReturned: number;
        cost: number;
        returnCost: number;
        suppliers: Set<string>;
      }
    > = {};
    filtered.forEach((inv) => {
      (inv.items || []).forEach((item: any) => {
        const pid = item.product_id || "__desc__" + (item.description || "");
        const name = item.product?.name || item.description || "منتج محذوف";
        if (!map[pid])
          map[pid] = {
            name,
            qtyPurchased: 0,
            qtyReturned: 0,
            cost: 0,
            returnCost: 0,
            suppliers: new Set(),
          };
        map[pid].qtyPurchased += Number(item.quantity);
        map[pid].cost += Number(item.net_total || item.total);
        if (inv.supplier_id) map[pid].suppliers.add(inv.supplier_id);
      });
    });
    Object.keys(map).forEach((pid) => {
      const ret = returnsByProduct[pid];
      if (ret) {
        map[pid].qtyReturned = ret.qty;
        map[pid].returnCost = ret.total;
      }
    });
    return Object.values(map)
      .map((p) => {
        const netQty = p.qtyPurchased - p.qtyReturned;
        const netCost = p.cost - p.returnCost;
        return {
          name: p.name,
          qtyPurchased: p.qtyPurchased,
          qtyReturned: p.qtyReturned,
          netQty,
          cost: p.cost,
          netCost,
          supplierCount: p.suppliers.size,
          avgUnitCost: p.qtyPurchased > 0 ? p.cost / p.qtyPurchased : 0,
          returnRate:
            p.qtyPurchased > 0 ? (p.qtyReturned / p.qtyPurchased) * 100 : 0,
        };
      })
      .sort((a, b) => b.netCost - a.netCost);
  }, [filtered, returnsByProduct]);

  const productColumns = useMemo<ColumnDef<any, any>[]>(
    () => [
      {
        accessorKey: "name",
        header: "المنتج",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
        footer: () => <span className="font-bold">الإجمالي</span>,
      },
      {
        accessorKey: "qtyPurchased",
        header: "الكمية المشتراة",
        footer: ({ table }) =>
          table
            .getFilteredRowModel()
            .rows.reduce((s, r) => s + r.original.qtyPurchased, 0),
      },
      {
        accessorKey: "qtyReturned",
        header: "المرتجع",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return v > 0 ? (
            <span className="text-destructive">{v}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
        footer: ({ table }) => (
          <span className="text-destructive">
            {table
              .getFilteredRowModel()
              .rows.reduce((s, r) => s + r.original.qtyReturned, 0)}
          </span>
        ),
      },
      {
        accessorKey: "netQty",
        header: "صافي الكمية",
        cell: ({ row }) => {
          const r = row.original;
          if (r.netQty <= 0 && r.qtyReturned > 0)
            return (
              <Badge variant="destructive" className="text-[10px] px-1.5">
                مرتجع كامل
              </Badge>
            );
          return r.netQty;
        },
        footer: ({ table }) =>
          table
            .getFilteredRowModel()
            .rows.reduce((s, r) => s + r.original.netQty, 0),
      },
      {
        accessorKey: "netCost",
        header: "صافي التكلفة",
        cell: ({ getValue }) => (
          <span className="font-bold font-mono">{fmt(getValue() as number)}</span>
        ),
        footer: ({ table }) => (
          <span className="font-bold font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce((s, r) => s + r.original.netCost, 0),
            )}
          </span>
        ),
      },
      {
        accessorKey: "avgUnitCost",
        header: "متوسط سعر الوحدة",
        cell: ({ getValue }) => (
          <span className="font-mono">{fmt(getValue() as number)}</span>
        ),
        footer: ({ table }) => {
          const tc = table
            .getFilteredRowModel()
            .rows.reduce((s, r) => s + r.original.cost, 0);
          const tq = table
            .getFilteredRowModel()
            .rows.reduce((s, r) => s + r.original.qtyPurchased, 0);
          return <span className="font-mono">{fmt(tq > 0 ? tc / tq : 0)}</span>;
        },
      },
      {
        accessorKey: "supplierCount",
        header: "الموردون",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          if (v <= 1)
            return (
              <span className="inline-flex items-center gap-1 text-amber-600 font-mono text-xs">
                <AlertTriangle className="w-3 h-3" />
                {v} مصدر
              </span>
            );
          return (
            <span className="font-mono text-xs text-emerald-600">
              {v} مصادر
            </span>
          );
        },
      },
      {
        accessorKey: "returnRate",
        header: "معدل الإرجاع",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          if (v === 0)
            return <span className="text-muted-foreground">—</span>;
          const color =
            v >= 20
              ? "text-destructive"
              : v >= 10
                ? "text-amber-600"
                : "text-emerald-600";
          return (
            <span className={`font-mono ${color}`}>{v.toFixed(1)}%</span>
          );
        },
      },
    ],
    [],
  );


  // ═══ GROUPING: By Time ═══
  const timeData = useMemo(() => {
    const map: Record<
      string,
      {
        key: string;
        label: string;
        count: number;
        total: number;
        returns: number;
      }
    > = {};
    filtered.forEach((inv) => {
      const key =
        timeMode === "daily"
          ? inv.invoice_date
          : inv.invoice_date?.substring(0, 7);
      if (!key) return;
      const label =
        timeMode === "daily"
          ? key
          : (() => {
              const [y, m] = key.split("-");
              const months = [
                "يناير",
                "فبراير",
                "مارس",
                "أبريل",
                "مايو",
                "يونيو",
                "يوليو",
                "أغسطس",
                "سبتمبر",
                "أكتوبر",
                "نوفمبر",
                "ديسمبر",
              ];
              return `${months[parseInt(m) - 1]} ${y}`;
            })();
      if (!map[key]) map[key] = { key, label, count: 0, total: 0, returns: 0 };
      map[key].count++;
      map[key].total += Number(inv.total);
    });
    Object.keys(returnsByDate).forEach((key) => {
      if (map[key]) map[key].returns = returnsByDate[key];
    });
    return Object.values(map)
      .map((d) => ({
        ...d,
        net: d.total - d.returns,
        returnRate: d.total > 0 ? (d.returns / d.total) * 100 : 0,
        avgInvoice: d.count > 0 ? d.total / d.count : 0,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [filtered, returnsByDate, timeMode]);

  const timeColumns = useMemo<ColumnDef<any, any>[]>(
    () => [
      {
        accessorKey: "label",
        header: timeMode === "daily" ? "التاريخ" : "الشهر",
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
        header: "الإجمالي",
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
        accessorKey: "net",
        header: "الصافي",
        cell: ({ getValue }) => (
          <span className="font-bold">{fmt(getValue() as number)}</span>
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
        header: "معدل الإرجاع",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          if (v === 0) return <span className="text-muted-foreground">—</span>;
          const color =
            v >= 10
              ? "text-destructive"
              : v >= 5
                ? "text-amber-600"
                : "text-emerald-600";
          return (
            <span className={`font-mono ${color}`}>{v.toFixed(1)}%</span>
          );
        },
      },
      {
        accessorKey: "avgInvoice",
        header: "متوسط الفاتورة",
        cell: ({ getValue }) => (
          <span className="font-mono text-muted-foreground">
            {fmt(getValue() as number)}
          </span>
        ),
      },
    ],
    [timeMode],
  );


  // ═══ GROUPING: By Category ═══
  const categoryData = useMemo(() => {
    const map: Record<
      string,
      {
        name: string;
        products: Set<string>;
        qty: number;
        cost: number;
        returns: number;
      }
    > = {};
    filtered.forEach((inv) => {
      (inv.items || []).forEach((item: any) => {
        const catId = item.product?.category_id || "__none__";
        const catName = item.product?.category?.name || "بدون تصنيف";
        if (!map[catId])
          map[catId] = {
            name: catName,
            products: new Set(),
            qty: 0,
            cost: 0,
            returns: 0,
          };
        if (item.product_id) map[catId].products.add(item.product_id);
        map[catId].qty += Number(item.quantity);
        map[catId].cost += Number(item.net_total || item.total);
      });
    });
    returns.forEach((r) => {
      (r.items || []).forEach((item: any) => {
        const catId = item.product?.category_id || "__none__";
        if (map[catId]) map[catId].returns += Number(item.total);
      });
    });
    const totalCost = Object.values(map).reduce((s, c) => s + c.cost, 0);
    return Object.values(map)
      .map((c) => ({
        name: c.name,
        productCount: c.products.size,
        qty: c.qty,
        cost: c.cost,
        returns: c.returns,
        net: c.cost - c.returns,
        pctOfTotal: totalCost > 0 ? (c.cost / totalCost) * 100 : 0,
        avgUnitCost: c.qty > 0 ? c.cost / c.qty : 0,
        returnRate: c.cost > 0 ? (c.returns / c.cost) * 100 : 0,
      }))
      .sort((a, b) => b.net - a.net);
  }, [filtered, returns]);

  const categoryColumns = useMemo<ColumnDef<any, any>[]>(
    () => [
      {
        accessorKey: "name",
        header: "التصنيف",
        footer: () => <span className="font-bold">الإجمالي</span>,
      },
      {
        accessorKey: "productCount",
        header: "عدد المنتجات",
        footer: ({ table }) =>
          table
            .getFilteredRowModel()
            .rows.reduce((s, r) => s + r.original.productCount, 0),
      },
      {
        accessorKey: "qty",
        header: "الكمية",
        footer: ({ table }) =>
          table
            .getFilteredRowModel()
            .rows.reduce((s, r) => s + r.original.qty, 0),
      },
      {
        accessorKey: "cost",
        header: "التكلفة",
        cell: ({ getValue }) => fmt(getValue() as number),
        footer: ({ table }) => (
          <span className="font-bold font-mono">
            {fmt(
              table
                .getFilteredRowModel()
                .rows.reduce((s, r) => s + r.original.cost, 0),
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
        accessorKey: "net",
        header: "الصافي",
        cell: ({ getValue }) => fmt(getValue() as number),
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
        accessorKey: "avgUnitCost",
        header: "متوسط سعر الوحدة",
        cell: ({ getValue }) => (
          <span className="font-mono">{fmt(getValue() as number)}</span>
        ),
      },
      {
        accessorKey: "returnRate",
        header: "معدل الإرجاع",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          if (v === 0) return <span className="text-muted-foreground">—</span>;
          const color =
            v >= 10
              ? "text-destructive"
              : v >= 5
                ? "text-amber-600"
                : "text-emerald-600";
          return (
            <span className={`font-mono ${color}`}>{v.toFixed(1)}%</span>
          );
        },
      },
      {
        accessorKey: "pctOfTotal",
        header: "% من الإجمالي",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          const color =
            v >= 30
              ? "text-primary font-bold"
              : "text-muted-foreground";
          return (
            <span className={`font-mono ${color}`}>{v.toFixed(1)}%</span>
          );
        },
      },
    ],
    [],
  );

  // ── Insights ──
  const insights = useMemo(() => {
    const out: {
      icon: any;
      text: string;
      severity: "info" | "warn" | "danger" | "good";
    }[] = [];
    // Supplier concentration
    if (supplierData.length > 0) {
      const top3 = supplierData.slice(0, 3);
      const top3Share = top3.reduce((s, c) => s + c.pctOfTotal, 0);
      if (supplierData.length >= 3 && top3Share >= 60) {
        out.push({
          icon: Users,
          severity: top3Share >= 80 ? "danger" : "warn",
          text: `${top3Share.toFixed(0)}% من مشترياتك متمركزة في 3 موردين فقط — نوّع مصادرك لتقليل المخاطر`,
        });
      } else if (supplierData.length >= 3) {
        out.push({
          icon: Users,
          severity: "good",
          text: `قاعدة موردين متنوعة (${supplierData.length} مورد) — أكبر اعتماد ${top3[0]?.pctOfTotal.toFixed(0)}%`,
        });
      }
    }
    // Returns rate trend
    const prevReturnsTotal = prevReturns.reduce(
      (s, r) => s + Number(r.total),
      0,
    );
    if (prevKpi.grossPurchases > 0 || kpi.grossPurchases > 0) {
      const currRate =
        kpi.grossPurchases > 0
          ? (kpi.returnsTotal / kpi.grossPurchases) * 100
          : 0;
      const prevRate =
        prevKpi.grossPurchases > 0
          ? (prevReturnsTotal / prevKpi.grossPurchases) * 100
          : 0;
      const delta = currRate - prevRate;
      if (Math.abs(delta) >= 1) {
        out.push({
          icon: delta > 0 ? TrendingUp : TrendingDown,
          severity: delta > 0 ? "danger" : "good",
          text:
            delta > 0
              ? `معدل الإرجاع ارتفع إلى ${currRate.toFixed(1)}% (+${delta.toFixed(1)} نقطة مقارنة بالفترة السابقة)`
              : `معدل الإرجاع انخفض إلى ${currRate.toFixed(1)}% (${delta.toFixed(1)} نقطة) — تحسّن في الجودة`,
        });
      }
    }
    // Top products contributing 50%
    if (productData.length >= 3) {
      const totalCost = productData.reduce((s, p) => s + p.netCost, 0);
      if (totalCost > 0) {
        const sorted = [...productData].sort((a, b) => b.netCost - a.netCost);
        let cumulative = 0;
        let count = 0;
        for (const p of sorted) {
          cumulative += p.netCost;
          count++;
          if (cumulative / totalCost >= 0.5) break;
        }
        out.push({
          icon: Package,
          severity: "info",
          text: `${count} منتج فقط يشكّل 50% من حجم مشترياتك — ركّز على ضبط أسعارها وجودتها`,
        });
      }
    }
    // Single-source products warning
    const singleSourceProducts = productData.filter(
      (p) => p.supplierCount === 1 && p.cost > 0,
    );
    if (singleSourceProducts.length >= 3 && productData.length > 0) {
      const share =
        (singleSourceProducts.length / productData.length) * 100;
      if (share >= 50) {
        out.push({
          icon: Target,
          severity: "warn",
          text: `${singleSourceProducts.length} منتج (${share.toFixed(0)}%) يُشترى من مصدر واحد فقط — ابحث عن موردين بدلاء`,
        });
      }
    }
    // Overdue
    if (overdueInfo.count > 0) {
      out.push({
        icon: AlertTriangle,
        severity: "danger",
        text: `${overdueInfo.count} فاتورة متأخرة بإجمالي ${fmt(overdueInfo.total)} — راجع التزاماتك مع الموردين`,
      });
    }
    return out;
  }, [
    supplierData,
    productData,
    kpi,
    prevKpi,
    prevReturns,
    overdueInfo,
  ]);

  // ── Chart data ──
  const chartData = useMemo(() => {
    if (groupBy === "time") {
      return timeData.map((d) => ({
        name: d.label,
        مشتريات: d.total,
        مرتجعات: d.returns,
        صافي: d.total - d.returns,
      }));
    }
    if (groupBy === "supplier") {
      return supplierData
        .slice(0, 10)
        .map((c) => ({
          name: c.name.length > 12 ? c.name.substring(0, 12) + "…" : c.name,
          المشتريات: c.total,
        }));
    }
    if (groupBy === "product") {
      return productData
        .slice(0, 10)
        .map((p) => ({
          name: p.name.length > 12 ? p.name.substring(0, 12) + "…" : p.name,
          التكلفة: p.cost,
        }));
    }
    if (groupBy === "category") {
      return categoryData
        .slice(0, 10)
        .map((c) => ({
          name: c.name.length > 12 ? c.name.substring(0, 12) + "…" : c.name,
          التكلفة: c.cost,
        }));
    }
    return [];
  }, [groupBy, timeData, supplierData, productData, categoryData]);

  // ── Pie data for supplier mode ──
  const pieData = useMemo(() => {
    if (groupBy !== "supplier") return [];
    const top5 = supplierData.slice(0, 5);
    const rest = supplierData.slice(5);
    const restTotal = rest.reduce((s, c) => s + c.total, 0);
    const result = top5.map((c) => ({ name: c.name, value: c.total }));
    if (restTotal > 0) result.push({ name: "أخرى", value: restTotal });
    return result;
  }, [groupBy, supplierData]);

  // ── Export config ──
  const exportConfig = useMemo(() => {
    const fmtN = (n: number) =>
      n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const summaryCards = [
      { label: "عدد الفواتير", value: String(kpi.count) },
      { label: "إجمالي المشتريات", value: fmtN(kpi.grossPurchases) },
      { label: "المرتجعات", value: fmtN(kpi.returnsTotal) },
      { label: "صافي المشتريات", value: fmtN(kpi.netPurchases) },
      {
        label: "متوسط الفاتورة",
        value: fmtN(kpi.count > 0 ? kpi.grossPurchases / kpi.count : 0),
      },
      {
        label: "المتأخرات",
        value: `${fmtN(overdueInfo.total)} (${overdueInfo.count} فاتورة)`,
      },
      { label: "إجمالي الخصم", value: fmtN(discountTaxInfo.discount) },
      { label: "إجمالي الضريبة", value: fmtN(discountTaxInfo.tax) },
    ];

    if (groupBy === "invoice") {
      return {
        filenamePrefix: `تقرير-المشتريات-${dateFrom}-${dateTo}`,
        sheetName: "المشتريات",
        pdfTitle: `تقرير المشتريات (${dateFrom} - ${dateTo})`,
        headers: [
          "رقم",
          "التاريخ",
          "المورد",
          "الحالة",
          "الإجمالي",
          "المدفوع",
          "المتبقي",
          "متأخر",
        ],
        rows: filtered.map((inv) => [
          formatDisplayNumber(
            settings?.purchase_invoice_prefix || "PUR-",
            inv.posted_number,
            inv.invoice_number,
            inv.status,
          ),
          inv.invoice_date,
          inv.supplier?.name || "-",
          inv.status === "posted"
            ? "مُرحّل"
            : inv.status === "cancelled"
              ? "ملغي"
              : "مسودة",
          Number(inv.total),
          Number(inv.paid_amount),
          Number(inv.total) - Number(inv.paid_amount),
          isOverdue(inv) ? "نعم" : "",
        ]),
        summaryCards,
        settings,
        pdfOrientation: "landscape" as const,
      };
    }
    if (groupBy === "supplier") {
      return {
        filenamePrefix: `تقرير-مشتريات-بالمورد-${dateFrom}-${dateTo}`,
        sheetName: "بالمورد",
        pdfTitle: `تقرير المشتريات بالمورد (${dateFrom} - ${dateTo})`,
        headers: [
          "المورد",
          "عدد الفواتير",
          "الإجمالي",
          "المرتجعات",
          "الصافي",
          "حصة %",
          "معدل الإرجاع",
          "متوسط الفاتورة",
          "المتبقي",
          "السداد%",
        ],
        rows: supplierData.map((c) => [
          c.name,
          c.count,
          c.total,
          c.returns,
          c.net,
          c.pctOfTotal.toFixed(1) + "%",
          c.returnRate.toFixed(1) + "%",
          c.avgInvoice.toFixed(2),
          c.remaining,
          c.paymentRate.toFixed(1) + "%",
        ]),
        summaryCards,
        settings,
        pdfOrientation: "landscape" as const,
      };
    }
    if (groupBy === "product") {
      return {
        filenamePrefix: `تقرير-مشتريات-بالمنتج-${dateFrom}-${dateTo}`,
        sheetName: "بالمنتج",
        pdfTitle: `تقرير المشتريات بالمنتج (${dateFrom} - ${dateTo})`,
        headers: [
          "المنتج",
          "الكمية",
          "المرتجع",
          "صافي الكمية",
          "صافي التكلفة",
          "متوسط سعر الوحدة",
          "عدد الموردين",
          "معدل الإرجاع",
        ],
        rows: productData.map((p) => [
          p.name,
          p.qtyPurchased,
          p.qtyReturned,
          p.netQty,
          p.netCost,
          p.avgUnitCost.toFixed(2),
          p.supplierCount,
          p.returnRate.toFixed(1) + "%",
        ]),
        summaryCards,
        settings,
        pdfOrientation: "landscape" as const,
      };
    }
    if (groupBy === "category") {
      return {
        filenamePrefix: `تقرير-مشتريات-بالتصنيف-${dateFrom}-${dateTo}`,
        sheetName: "بالتصنيف",
        pdfTitle: `تقرير المشتريات بالتصنيف (${dateFrom} - ${dateTo})`,
        headers: [
          "التصنيف",
          "عدد المنتجات",
          "الكمية",
          "التكلفة",
          "المرتجعات",
          "الصافي",
          "متوسط سعر الوحدة",
          "معدل الإرجاع",
          "% من الإجمالي",
        ],
        rows: categoryData.map((c) => [
          c.name,
          c.productCount,
          c.qty,
          c.cost,
          c.returns,
          c.net,
          c.avgUnitCost.toFixed(2),
          c.returnRate.toFixed(1) + "%",
          c.pctOfTotal.toFixed(1) + "%",
        ]),
        summaryCards,
        settings,
        pdfOrientation: "landscape" as const,
      };
    }
    return {
      filenamePrefix: `تقرير-المشتريات-${timeMode === "daily" ? "يومي" : "شهري"}-${dateFrom}-${dateTo}`,
      sheetName: timeMode === "daily" ? "يومي" : "شهري",
      pdfTitle: `تقرير المشتريات ${timeMode === "daily" ? "اليومي" : "الشهري"} (${dateFrom} - ${dateTo})`,
      headers: [
        timeMode === "daily" ? "التاريخ" : "الشهر",
        "عدد الفواتير",
        "الإجمالي",
        "المرتجعات",
        "الصافي",
        "معدل الإرجاع",
        "متوسط الفاتورة",
      ],
      rows: timeData.map((d) => [
        d.label,
        d.count,
        d.total,
        d.returns,
        d.net,
        d.returnRate.toFixed(1) + "%",
        d.avgInvoice.toFixed(2),
      ]),
      summaryCards,
      settings,
    };
  }, [
    groupBy,
    filtered,
    supplierData,
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
  ]);

  const isLoading = loadingInv;

  return (
    <div className="space-y-5 p-1">
      {/* ── Filters ── */}
      <Card className="border shadow-sm">
        <CardContent className="py-3 px-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="flex items-center gap-2">
                <DatePickerInput
                  value={dateFrom}
                  onChange={setDateFrom}
                  placeholder="من تاريخ"
                  className="w-[140px]"
                />
                <span className="text-muted-foreground/30">—</span>
                <DatePickerInput
                  value={dateTo}
                  onChange={setDateTo}
                  placeholder="إلى تاريخ"
                  className="w-[140px]"
                />
              </div>

              <div className="h-7 w-px bg-border/60 hidden md:block" />

              <Select
                value={statusFilter}
                onValueChange={(v: any) => setStatusFilter(v)}
              >
                <SelectTrigger className="w-[130px] font-medium h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="posted">مُرحّل</SelectItem>
                  <SelectItem value="draft">مسودة</SelectItem>
                  <SelectItem value="cancelled">ملغي</SelectItem>
                </SelectContent>
              </Select>

              <Select value={groupBy} onValueChange={(v: any) => setGroupBy(v)}>
                <SelectTrigger className="w-[140px] font-medium h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="invoice">الفاتورة</SelectItem>
                  <SelectItem value="supplier">المورد</SelectItem>
                  <SelectItem value="product">المنتج</SelectItem>
                  <SelectItem value="time">يومي/شهري</SelectItem>
                  <SelectItem value="category">التصنيف</SelectItem>
                </SelectContent>
              </Select>

              {groupBy === "time" && (
                <>
                  <div className="h-7 w-px bg-border/60 hidden md:block" />
                  <ToggleGroup
                    type="single"
                    value={timeMode}
                    onValueChange={(v) => v && setTimeMode(v as any)}
                    className="border rounded-lg p-0.5"
                  >
                    <ToggleGroupItem value="daily" className="text-xs px-3 h-8">
                      يومي
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="monthly"
                      className="text-xs px-3 h-8"
                    >
                      شهري
                    </ToggleGroupItem>
                  </ToggleGroup>
                </>
              )}
            </div>

            <div className="shrink-0">
              <ExportMenu config={exportConfig} disabled={isLoading} />
            </div>
          </div>
          {/* Quick Date Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            {quickRanges.map((p) => (
              <Button
                key={p.label}
                variant={
                  dateFrom === p.from && dateTo === p.to ? "default" : "outline"
                }
                size="sm"
                className="h-7 text-xs px-2.5 rounded-full"
                onClick={() => {
                  setDateFrom(p.from);
                  setDateTo(p.to);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {/* عدد الفواتير */}
        <Card className="relative overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0 shadow-inner">
                <ReceiptText className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  عدد الفواتير
                </p>
                {isLoading ? (
                  <Skeleton className="h-7 w-12" />
                ) : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums">
                    {kpi.count}
                  </p>
                )}
                <GrowthBadge current={kpi.count} previous={prevKpi.count} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* إجمالي المشتريات */}
        <Card className="relative overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-transparent pointer-events-none" />
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-blue-500/10 flex items-center justify-center shrink-0 shadow-inner">
                <ShoppingCart className="w-5 h-5 text-blue-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  إجمالي المشتريات
                </p>
                {isLoading ? (
                  <Skeleton className="h-7 w-20" />
                ) : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums truncate">
                    {fmt(kpi.grossPurchases)}
                  </p>
                )}
                <GrowthBadge
                  current={kpi.grossPurchases}
                  previous={prevKpi.grossPurchases}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* المرتجعات */}
        <Card className="relative overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-destructive/5 via-transparent to-transparent pointer-events-none" />
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-destructive/10 flex items-center justify-center shrink-0 shadow-inner">
                <ArrowDownLeft className="w-5 h-5 text-destructive" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  المرتجعات
                </p>
                {isLoading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums text-destructive">
                    {fmt(kpi.returnsTotal)}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* صافي المشتريات */}
        <Card className="relative overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent pointer-events-none" />
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 flex items-center justify-center shrink-0 shadow-inner">
                <TrendingDown className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  صافي المشتريات
                </p>
                {isLoading ? (
                  <Skeleton className="h-7 w-20" />
                ) : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums truncate">
                    {fmt(kpi.netPurchases)}
                  </p>
                )}
                <GrowthBadge
                  current={kpi.netPurchases}
                  previous={prevKpi.netPurchases}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* المدفوع */}
        <Card className="relative overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-transparent to-transparent pointer-events-none" />
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-violet-500/10 flex items-center justify-center shrink-0 shadow-inner">
                <DollarSign className="w-5 h-5 text-violet-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  المدفوع
                </p>
                {isLoading ? (
                  <Skeleton className="h-7 w-20" />
                ) : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums truncate">
                    {fmt(kpi.paid)}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* نسبة السداد */}
        <Card className="relative overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent pointer-events-none" />
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-amber-500/10 flex items-center justify-center shrink-0 shadow-inner">
                <Percent className="w-5 h-5 text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  نسبة السداد
                </p>
                {isLoading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums">
                    {kpi.paymentRate.toFixed(1)}%
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Extra KPI row: avg invoice, overdue, discount/tax ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* متوسط الفاتورة */}
        <Card className="border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">
              متوسط الفاتورة
            </p>
            {isLoading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <p className="text-lg font-bold tabular-nums">
                {fmt(kpi.count > 0 ? kpi.grossPurchases / kpi.count : 0)}
              </p>
            )}
            <GrowthBadge
              current={kpi.count > 0 ? kpi.grossPurchases / kpi.count : 0}
              previous={
                prevKpi.count > 0 ? prevKpi.grossPurchases / prevKpi.count : 0
              }
            />
          </CardContent>
        </Card>
        {/* المتأخرات */}
        <Card
          className={`border shadow-sm ${overdueInfo.count > 0 ? "border-destructive/30" : ""}`}
        >
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs font-medium text-muted-foreground">
                المتأخرات
              </p>
              {overdueInfo.count > 0 && (
                <Badge
                  variant="destructive"
                  className="text-[10px] px-1.5 py-0"
                >
                  {overdueInfo.count}
                </Badge>
              )}
            </div>
            {isLoading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <p
                className={`text-lg font-bold tabular-nums ${overdueInfo.total > 0 ? "text-destructive" : ""}`}
              >
                {fmt(overdueInfo.total)}
              </p>
            )}
          </CardContent>
        </Card>
        {/* الخصم */}
        <Card className="border shadow-sm">
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
        {/* الضريبة */}
        <Card className="border shadow-sm">
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
      </div>

      {/* ── Chart ── */}
      {groupBy !== "invoice" && chartData.length > 0 && (
        <div
          className={
            groupBy === "supplier"
              ? "grid grid-cols-1 md:grid-cols-2 gap-4"
              : ""
          }
        >
          <Card>
            <CardContent className="pt-4">
              <ResponsiveContainer width="100%" height={260}>
                {groupBy === "time" ? (
                  <ComposedChart data={chartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      dataKey="name"
                      fontSize={11}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis fontSize={11} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: "8px",
                        border: "1px solid hsl(var(--border))",
                        fontSize: "12px",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Bar
                      dataKey="مشتريات"
                      fill="hsl(var(--primary))"
                      radius={[4, 4, 0, 0]}
                      barSize={28}
                    />
                    <Bar
                      dataKey="مرتجعات"
                      fill="hsl(var(--destructive))"
                      radius={[4, 4, 0, 0]}
                      barSize={28}
                    />
                    <Line
                      type="monotone"
                      dataKey="صافي"
                      stroke="hsl(152, 60%, 42%)"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                    />
                  </ComposedChart>
                ) : (
                  <BarChart data={chartData} layout="vertical" barSize={20}>
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
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      fontSize={11}
                      axisLine={false}
                      tickLine={false}
                      width={100}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: "8px",
                        border: "1px solid hsl(var(--border))",
                        fontSize: "12px",
                      }}
                    />
                    <Bar
                      dataKey={groupBy === "supplier" ? "المشتريات" : "التكلفة"}
                      fill="hsl(var(--primary))"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </CardContent>
          </Card>
          {groupBy === "supplier" && pieData.length > 0 && (
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs font-medium text-muted-foreground mb-2 text-center">
                  توزيع المشتريات بالمورد
                </p>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={85}
                      label={({ name, percent }) =>
                        `${name} ${(percent * 100).toFixed(0)}%`
                      }
                      labelLine={false}
                      fontSize={10}
                    >
                      {pieData.map((_, i) => (
                        <Cell
                          key={i}
                          fill={CHART_COLORS[i % CHART_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: "8px",
                        border: "1px solid hsl(var(--border))",
                        fontSize: "12px",
                      }}
                      formatter={(v: any) => fmt(v)}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Insights Strip ── */}
      {!isLoading && insights.length > 0 && (
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-transparent">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb className="w-4 h-4 text-primary" />
              <p className="text-sm font-bold text-primary">
                رؤى ذكية ({insights.length})
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {insights.map((ins, i) => {
                const Icon = ins.icon;
                const colorMap = {
                  danger:
                    "bg-destructive/5 border-destructive/30 text-destructive",
                  warn: "bg-amber-500/5 border-amber-500/30 text-amber-700 dark:text-amber-500",
                  good: "bg-emerald-500/5 border-emerald-500/30 text-emerald-700 dark:text-emerald-500",
                  info: "bg-blue-500/5 border-blue-500/30 text-blue-700 dark:text-blue-500",
                };
                return (
                  <div
                    key={i}
                    className={`flex items-start gap-2 p-2.5 rounded-lg border ${colorMap[ins.severity]}`}
                  >
                    <Icon className="w-4 h-4 mt-0.5 shrink-0" />
                    <p className="text-xs leading-relaxed text-foreground">
                      {ins.text}
                    </p>
                  </div>
                );
              })}
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
              data={filtered}
              isLoading={isLoading}
              pageSize={20}
              showPagination
              showSearch
              searchPlaceholder="بحث في الفواتير..."
              emptyMessage="لا توجد فواتير في هذه الفترة"
            />
          ) : groupBy === "supplier" ? (
            <DataTable
              columns={supplierColumns}
              data={supplierData}
              isLoading={isLoading}
              pageSize={20}
              showPagination
              showSearch
              searchPlaceholder="بحث بالمورد..."
              emptyMessage="لا توجد بيانات"
              sorting={supplierSort}
              onSortingChange={setSupplierSort}
              toolbarContent={
                <QuickSortToolbar
                  sorting={supplierSort}
                  setSorting={setSupplierSort}
                  buttons={[
                    { id: "net", label: "الصافي" },
                    { id: "returnRate", label: "معدل الإرجاع" },
                    { id: "paymentRate", label: "السداد" },
                    { id: "pctOfTotal", label: "الحصة" },
                  ]}
                />
              }
            />
          ) : groupBy === "product" ? (
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
              onSortingChange={setProductSort}
              toolbarContent={
                <QuickSortToolbar
                  sorting={productSort}
                  setSorting={setProductSort}
                  buttons={[
                    { id: "netCost", label: "صافي التكلفة" },
                    { id: "qtyPurchased", label: "الكمية" },
                    { id: "avgUnitCost", label: "سعر الوحدة" },
                    { id: "returnRate", label: "معدل الإرجاع" },
                  ]}
                />
              }
            />
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
              sorting={categorySort}
              onSortingChange={setCategorySort}
              toolbarContent={
                <QuickSortToolbar
                  sorting={categorySort}
                  setSorting={setCategorySort}
                  buttons={[
                    { id: "net", label: "الصافي" },
                    { id: "qty", label: "الكمية" },
                    { id: "avgUnitCost", label: "سعر الوحدة" },
                    { id: "returnRate", label: "معدل الإرجاع" },
                  ]}
                />
              }
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
              sorting={timeSort}
              onSortingChange={setTimeSort}
              toolbarContent={
                <QuickSortToolbar
                  sorting={timeSort}
                  setSorting={setTimeSort}
                  buttons={[
                    { id: "net", label: "الصافي" },
                    { id: "total", label: "الإجمالي" },
                    { id: "returnRate", label: "معدل الإرجاع" },
                  ]}
                />
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
