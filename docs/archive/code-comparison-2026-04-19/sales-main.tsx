import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DatePickerInput } from "@/components/DatePickerInput";
import { DataTable } from "@/components/ui/data-table";
import { ExportMenu } from "@/components/ExportMenu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ColumnDef } from "@tanstack/react-table";
import { format, startOfMonth, endOfMonth, subDays } from "date-fns";
import { ar } from "date-fns/locale";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useSettings } from "@/contexts/SettingsContext";
import { FileText, TrendingUp, TrendingDown, ArrowDownLeft, ReceiptText, Percent, DollarSign, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDisplayNumber } from "@/lib/posted-number-utils";

// ── helpers ──
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SalesReport() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));
  const [statusFilter, setStatusFilter] = useState<"all" | "posted" | "draft" | "cancelled">("posted");
  const [groupBy, setGroupBy] = useState<"invoice" | "customer" | "product" | "time">("invoice");
  const [timeMode, setTimeMode] = useState<"daily" | "monthly">("daily");

  // ── Query 1: Invoices ──
  const { data: invoices = [], isLoading: loadingInv } = useQuery({
    queryKey: ["sr-invoices", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select("id, invoice_number, invoice_date, due_date, status, subtotal, discount, tax, total, paid_amount, customer_id, customer:customers(name), items:sales_invoice_items(quantity, total, net_total, product_id, product:products(name))")
        .gte("invoice_date", dateFrom)
        .lte("invoice_date", dateTo)
        .order("invoice_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  // ── Query 2: Returns ──
  const { data: returns = [] } = useQuery({
    queryKey: ["sr-returns", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_returns")
        .select("id, return_date, total, status, customer_id, customer:customers(name), items:sales_return_items(quantity, total, product_id)")
        .eq("status", "posted")
        .gte("return_date", dateFrom)
        .lte("return_date", dateTo);
      if (error) throw error;
      return data as any[];
    },
  });

  // ── Query 3: COGS from inventory_movements ──
  const { data: movements = [] } = useQuery({
    queryKey: ["sr-cogs", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("product_id, movement_type, quantity, total_cost, movement_date")
        .in("movement_type", ["sale", "sale_return"])
        .gte("movement_date", dateFrom)
        .lte("movement_date", dateTo);
      if (error) throw error;
      return data as any[];
    },
  });

  // ── Filtered invoices ──
  const filtered = useMemo(() => {
    if (statusFilter === "all") return invoices;
    return invoices.filter(inv => inv.status === statusFilter);
  }, [invoices, statusFilter]);

  const isPostedOnly = statusFilter === "posted";

  // ── KPI summary (always from posted invoices) ──
  const kpi = useMemo(() => {
    const posted = invoices.filter(i => i.status === "posted");
    const grossSales = posted.reduce((s, i) => s + Number(i.total), 0);
    const paid = posted.reduce((s, i) => s + Number(i.paid_amount), 0);
    const returnsTotal = returns.reduce((s, r) => s + Number(r.total), 0);
    const netSales = grossSales - returnsTotal;
    const cogs = movements
      .filter(m => m.movement_type === "sale")
      .reduce((s, m) => s + Number(m.total_cost), 0)
      - movements
        .filter(m => m.movement_type === "sale_return")
        .reduce((s, m) => s + Number(m.total_cost), 0);
    const grossProfit = netSales - cogs;
    const collectionRate = netSales > 0 ? (paid / netSales) * 100 : 0;
    return {
      count: posted.length,
      grossSales,
      returnsTotal,
      netSales,
      grossProfit,
      paid,
      collectionRate: Math.min(collectionRate, 100),
      cogs,
    };
  }, [invoices, returns, movements]);

  // ── Returns map by customer ──
  const returnsByCustomer = useMemo(() => {
    const map: Record<string, number> = {};
    returns.forEach(r => {
      const cid = r.customer_id || "__none__";
      map[cid] = (map[cid] || 0) + Number(r.total);
    });
    return map;
  }, [returns]);

  // ── Returns map by product ──
  const returnsByProduct = useMemo(() => {
    const map: Record<string, { qty: number; total: number }> = {};
    returns.forEach(r => {
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
    returns.forEach(r => {
      const key = timeMode === "daily" ? r.return_date : r.return_date?.substring(0, 7);
      map[key] = (map[key] || 0) + Number(r.total);
    });
    return map;
  }, [returns, timeMode]);

  // ── Overdue check ──
  const today = format(new Date(), "yyyy-MM-dd");
  const isOverdue = (inv: any) => inv.due_date && inv.due_date < today && Number(inv.total) - Number(inv.paid_amount) > 0;

  // ═══ GROUPING: By Invoice ═══
  const invoiceColumns = useMemo<ColumnDef<any, any>[]>(() => [
    {
      accessorKey: "invoice_number",
      header: "رقم الفاتورة",
      cell: ({ row }) => {
        const inv = row.original;
        const display = formatDisplayNumber(
          settings?.sales_invoice_prefix || "INV-",
          inv.posted_number,
          inv.invoice_number,
          inv.status
        );
        return (
          <button
            className="text-primary hover:underline font-mono font-medium"
            onClick={(e) => { e.stopPropagation(); navigate(`/sales/${inv.id}`); }}
          >
            {display}
          </button>
        );
      },
      footer: () => <span className="font-bold">الإجمالي</span>,
    },
    { accessorKey: "invoice_date", header: "التاريخ" },
    {
      id: "customer",
      header: "العميل",
      accessorFn: (row: any) => row.customer?.name || "عميل نقدي",
    },
    {
      accessorKey: "status",
      header: "الحالة",
      cell: ({ row }) => {
        const s = row.original.status;
        return (
          <Badge variant={s === "posted" ? "default" : s === "cancelled" ? "destructive" : "secondary"}>
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
        const total = table.getFilteredRowModel().rows.reduce((s, r) => s + Number(r.original.total), 0);
        return <span className="font-bold font-mono">{fmt(total)}</span>;
      },
    },
    {
      id: "paid",
      header: "المدفوع",
      accessorFn: (r: any) => Number(r.paid_amount),
      cell: ({ getValue }) => fmt(getValue() as number),
      footer: ({ table }) => {
        const total = table.getFilteredRowModel().rows.reduce((s, r) => s + Number(r.original.paid_amount), 0);
        return <span className="font-mono">{fmt(total)}</span>;
      },
    },
    {
      id: "remaining",
      header: "المتبقي",
      accessorFn: (r: any) => Number(r.total) - Number(r.paid_amount),
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return <span className={v > 0 ? "text-destructive font-medium" : ""}>{fmt(v)}</span>;
      },
      footer: ({ table }) => {
        const total = table.getFilteredRowModel().rows.reduce((s, r) => s + Number(r.original.total) - Number(r.original.paid_amount), 0);
        return <span className="font-mono text-destructive">{fmt(total)}</span>;
      },
    },
    {
      id: "overdue",
      header: "متأخر",
      cell: ({ row }) => isOverdue(row.original)
        ? <Badge variant="destructive" className="text-[10px] px-1.5"><AlertTriangle className="w-3 h-3 ml-0.5" />متأخر</Badge>
        : null,
    },
  ], [navigate, today]);

  // ═══ GROUPING: By Customer ═══
  const customerData = useMemo(() => {
    const map: Record<string, { name: string; count: number; total: number; paid: number; returns: number }> = {};
    filtered.forEach(inv => {
      const cid = inv.customer_id || "__none__";
      const name = inv.customer?.name || "عميل نقدي";
      if (!map[cid]) map[cid] = { name, count: 0, total: 0, paid: 0, returns: 0 };
      map[cid].count++;
      map[cid].total += Number(inv.total);
      map[cid].paid += Number(inv.paid_amount);
    });
    // Add returns
    Object.keys(map).forEach(cid => {
      map[cid].returns = returnsByCustomer[cid] || 0;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [filtered, returnsByCustomer]);

  const customerColumns = useMemo<ColumnDef<any, any>[]>(() => [
    { accessorKey: "name", header: "العميل", footer: () => <span className="font-bold">الإجمالي</span> },
    { accessorKey: "count", header: "عدد الفواتير", footer: ({ table }) => table.getFilteredRowModel().rows.reduce((s, r) => s + r.original.count, 0) },
    {
      accessorKey: "total", header: "الإجمالي",
      cell: ({ getValue }) => fmt(getValue() as number),
      footer: ({ table }) => <span className="font-bold font-mono">{fmt(table.getFilteredRowModel().rows.reduce((s, r) => s + r.original.total, 0))}</span>,
    },
    {
      accessorKey: "returns", header: "المرتجعات",
      cell: ({ getValue }) => <span className="text-destructive">{fmt(getValue() as number)}</span>,
      footer: ({ table }) => <span className="text-destructive font-mono">{fmt(table.getFilteredRowModel().rows.reduce((s, r) => s + r.original.returns, 0))}</span>,
    },
    {
      id: "net", header: "الصافي",
      accessorFn: (r: any) => r.total - r.returns,
      cell: ({ getValue }) => fmt(getValue() as number),
      footer: ({ table }) => <span className="font-bold font-mono">{fmt(table.getFilteredRowModel().rows.reduce((s, r) => s + r.original.total - r.original.returns, 0))}</span>,
    },
    {
      accessorKey: "paid", header: "المدفوع",
      cell: ({ getValue }) => fmt(getValue() as number),
      footer: ({ table }) => <span className="font-mono">{fmt(table.getFilteredRowModel().rows.reduce((s, r) => s + r.original.paid, 0))}</span>,
    },
    {
      id: "remaining", header: "المتبقي",
      accessorFn: (r: any) => r.total - r.paid,
      cell: ({ getValue }) => { const v = getValue() as number; return <span className={v > 0 ? "text-destructive" : ""}>{fmt(v)}</span>; },
      footer: ({ table }) => {
        const t = table.getFilteredRowModel().rows.reduce((s, r) => s + r.original.total - r.original.paid, 0);
        return <span className="text-destructive font-mono">{fmt(t)}</span>;
      },
    },
    {
      id: "collection", header: "التحصيل%",
      accessorFn: (r: any) => { const net = r.total - r.returns; return net > 0 ? Math.min((r.paid / net) * 100, 100) : 0; },
      cell: ({ getValue }) => <span className="font-mono">{(getValue() as number).toFixed(1)}%</span>,
    },
  ], []);

  // ═══ GROUPING: By Product ═══
  const productData = useMemo(() => {
    const map: Record<string, { name: string; qtySold: number; qtyReturned: number; revenue: number }> = {};
    filtered.forEach(inv => {
      (inv.items || []).forEach((item: any) => {
        const pid = item.product_id || "__desc__" + (item.description || "");
        const name = item.product?.name || item.description || "منتج محذوف";
        if (!map[pid]) map[pid] = { name, qtySold: 0, qtyReturned: 0, revenue: 0 };
        map[pid].qtySold += Number(item.quantity);
        map[pid].revenue += Number(item.net_total || item.total);
      });
    });
    Object.keys(map).forEach(pid => {
      const ret = returnsByProduct[pid];
      if (ret) map[pid].qtyReturned = ret.qty;
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [filtered, returnsByProduct]);

  const productColumns = useMemo<ColumnDef<any, any>[]>(() => [
    { accessorKey: "name", header: "المنتج", footer: () => <span className="font-bold">الإجمالي</span> },
    { accessorKey: "qtySold", header: "الكمية المباعة", footer: ({ table }) => table.getFilteredRowModel().rows.reduce((s, r) => s + r.original.qtySold, 0) },
    {
      accessorKey: "qtyReturned", header: "المرتجع",
      cell: ({ getValue }) => <span className="text-destructive">{getValue() as number}</span>,
      footer: ({ table }) => <span className="text-destructive">{table.getFilteredRowModel().rows.reduce((s, r) => s + r.original.qtyReturned, 0)}</span>,
    },
    {
      id: "netQty", header: "صافي الكمية",
      accessorFn: (r: any) => r.qtySold - r.qtyReturned,
      footer: ({ table }) => table.getFilteredRowModel().rows.reduce((s, r) => s + r.original.qtySold - r.original.qtyReturned, 0),
    },
    {
      accessorKey: "revenue", header: "الإيرادات",
      cell: ({ getValue }) => fmt(getValue() as number),
      footer: ({ table }) => <span className="font-bold font-mono">{fmt(table.getFilteredRowModel().rows.reduce((s, r) => s + r.original.revenue, 0))}</span>,
    },
  ], []);

  // ═══ GROUPING: By Time ═══
  const timeData = useMemo(() => {
    const map: Record<string, { key: string; label: string; count: number; total: number; returns: number }> = {};
    filtered.forEach(inv => {
      const key = timeMode === "daily" ? inv.invoice_date : inv.invoice_date?.substring(0, 7);
      if (!key) return;
      const label = timeMode === "daily" ? key : (() => {
        const [y, m] = key.split("-");
        const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
        return `${months[parseInt(m) - 1]} ${y}`;
      })();
      if (!map[key]) map[key] = { key, label, count: 0, total: 0, returns: 0 };
      map[key].count++;
      map[key].total += Number(inv.total);
    });
    // Add returns
    Object.keys(returnsByDate).forEach(key => {
      if (map[key]) map[key].returns = returnsByDate[key];
    });
    return Object.values(map).sort((a, b) => a.key.localeCompare(b.key));
  }, [filtered, returnsByDate, timeMode]);

  const timeColumns = useMemo<ColumnDef<any, any>[]>(() => [
    { accessorKey: "label", header: timeMode === "daily" ? "التاريخ" : "الشهر", footer: () => <span className="font-bold">الإجمالي</span> },
    { accessorKey: "count", header: "عدد الفواتير", footer: ({ table }) => table.getFilteredRowModel().rows.reduce((s, r) => s + r.original.count, 0) },
    {
      accessorKey: "total", header: "الإجمالي",
      cell: ({ getValue }) => fmt(getValue() as number),
      footer: ({ table }) => <span className="font-bold font-mono">{fmt(table.getFilteredRowModel().rows.reduce((s, r) => s + r.original.total, 0))}</span>,
    },
    {
      accessorKey: "returns", header: "المرتجعات",
      cell: ({ getValue }) => <span className="text-destructive">{fmt(getValue() as number)}</span>,
      footer: ({ table }) => <span className="text-destructive font-mono">{fmt(table.getFilteredRowModel().rows.reduce((s, r) => s + r.original.returns, 0))}</span>,
    },
    {
      id: "net", header: "الصافي",
      accessorFn: (r: any) => r.total - r.returns,
      cell: ({ getValue }) => <span className="font-bold">{fmt(getValue() as number)}</span>,
      footer: ({ table }) => <span className="font-bold font-mono">{fmt(table.getFilteredRowModel().rows.reduce((s, r) => s + r.original.total - r.original.returns, 0))}</span>,
    },
  ], [timeMode]);

  // ── Chart data for time and customer/product ──
  const chartData = useMemo(() => {
    if (groupBy === "time") {
      return timeData.map(d => ({ name: d.label, مبيعات: d.total, مرتجعات: d.returns }));
    }
    if (groupBy === "customer") {
      return customerData.slice(0, 10).map(c => ({ name: c.name.length > 12 ? c.name.substring(0, 12) + "…" : c.name, المبيعات: c.total }));
    }
    if (groupBy === "product") {
      return productData.slice(0, 10).map(p => ({ name: p.name.length > 12 ? p.name.substring(0, 12) + "…" : p.name, الإيرادات: p.revenue }));
    }
    return [];
  }, [groupBy, timeData, customerData, productData]);

  // ── Export config ──
  const exportConfig = useMemo(() => {
    const fmtN = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const summaryCards = [
      { label: "عدد الفواتير", value: String(kpi.count) },
      { label: "إجمالي المبيعات", value: fmtN(kpi.grossSales) },
      { label: "المرتجعات", value: fmtN(kpi.returnsTotal) },
      { label: "صافي المبيعات", value: fmtN(kpi.netSales) },
    ];

    if (groupBy === "invoice") {
      return {
        filenamePrefix: `تقرير-المبيعات-${dateFrom}-${dateTo}`,
        sheetName: "المبيعات",
        pdfTitle: `تقرير المبيعات (${dateFrom} - ${dateTo})`,
        headers: ["رقم", "التاريخ", "العميل", "الحالة", "الإجمالي", "المدفوع", "المتبقي", "متأخر"],
        rows: filtered.map(inv => [
          formatDisplayNumber(settings?.sales_invoice_prefix || "INV-", inv.posted_number, inv.invoice_number, inv.status),
          inv.invoice_date, inv.customer?.name || "-",
          inv.status === "posted" ? "مُرحّل" : inv.status === "cancelled" ? "ملغي" : "مسودة",
          Number(inv.total), Number(inv.paid_amount), Number(inv.total) - Number(inv.paid_amount),
          isOverdue(inv) ? "نعم" : "",
        ]),
        summaryCards,
        settings,
        pdfOrientation: "landscape" as const,
      };
    }
    if (groupBy === "customer") {
      return {
        filenamePrefix: `تقرير-مبيعات-بالعميل-${dateFrom}-${dateTo}`,
        sheetName: "بالعميل",
        pdfTitle: `تقرير المبيعات بالعميل (${dateFrom} - ${dateTo})`,
        headers: ["العميل", "عدد الفواتير", "الإجمالي", "المرتجعات", "الصافي", "المدفوع", "المتبقي", "التحصيل%"],
        rows: customerData.map(c => [c.name, c.count, c.total, c.returns, c.total - c.returns, c.paid, c.total - c.paid, ((c.total - c.returns) > 0 ? Math.min((c.paid / (c.total - c.returns)) * 100, 100).toFixed(1) + "%" : "0%")]),
        summaryCards,
        settings,
        pdfOrientation: "landscape" as const,
      };
    }
    if (groupBy === "product") {
      return {
        filenamePrefix: `تقرير-مبيعات-بالمنتج-${dateFrom}-${dateTo}`,
        sheetName: "بالمنتج",
        pdfTitle: `تقرير المبيعات بالمنتج (${dateFrom} - ${dateTo})`,
        headers: ["المنتج", "الكمية المباعة", "المرتجع", "صافي الكمية", "الإيرادات"],
        rows: productData.map(p => [p.name, p.qtySold, p.qtyReturned, p.qtySold - p.qtyReturned, p.revenue]),
        summaryCards,
        settings,
      };
    }
    // time
    return {
      filenamePrefix: `تقرير-مبيعات-${timeMode === "daily" ? "يومي" : "شهري"}-${dateFrom}-${dateTo}`,
      sheetName: timeMode === "daily" ? "يومي" : "شهري",
      pdfTitle: `تقرير المبيعات ${timeMode === "daily" ? "اليومي" : "الشهري"} (${dateFrom} - ${dateTo})`,
      headers: [timeMode === "daily" ? "التاريخ" : "الشهر", "عدد الفواتير", "الإجمالي", "المرتجعات", "الصافي"],
      rows: timeData.map(d => [d.label, d.count, d.total, d.returns, d.total - d.returns]),
      summaryCards,
      settings,
    };
  }, [groupBy, filtered, customerData, productData, timeData, kpi, dateFrom, dateTo, settings, timeMode]);

  const isLoading = loadingInv;

  return (
    <div className="space-y-5 p-1">
      {/* ── Filters Card (ProductAnalytics style) ── */}
      <Card className="border shadow-sm">
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-center justify-between gap-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              {/* Date Range */}
              <div className="flex items-center gap-2">
                <DatePickerInput value={dateFrom} onChange={setDateFrom} placeholder="من تاريخ" className="w-[140px]" />
                <span className="text-muted-foreground/30">—</span>
                <DatePickerInput value={dateTo} onChange={setDateTo} placeholder="إلى تاريخ" className="w-[140px]" />
              </div>

              <div className="h-7 w-px bg-border/60 hidden md:block" />

              {/* Status */}
              <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                <SelectTrigger className="w-[130px] font-medium h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="posted">مُرحّل</SelectItem>
                  <SelectItem value="draft">مسودة</SelectItem>
                  <SelectItem value="cancelled">ملغي</SelectItem>
                </SelectContent>
              </Select>

              {/* Group By */}
              <Select value={groupBy} onValueChange={(v: any) => setGroupBy(v)}>
                <SelectTrigger className="w-[140px] font-medium h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="invoice">الفاتورة</SelectItem>
                  <SelectItem value="customer">العميل</SelectItem>
                  <SelectItem value="product">المنتج</SelectItem>
                  <SelectItem value="time">يومي/شهري</SelectItem>
                </SelectContent>
              </Select>

              {groupBy === "time" && (
                <>
                  <div className="h-7 w-px bg-border/60 hidden md:block" />
                  <ToggleGroup type="single" value={timeMode} onValueChange={(v) => v && setTimeMode(v as any)} className="border rounded-lg p-0.5">
                    <ToggleGroupItem value="daily" className="text-xs px-3 h-8">يومي</ToggleGroupItem>
                    <ToggleGroupItem value="monthly" className="text-xs px-3 h-8">شهري</ToggleGroupItem>
                  </ToggleGroup>
                </>
              )}
            </div>

            <div className="shrink-0">
              <ExportMenu config={exportConfig} disabled={isLoading} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── KPI Cards (ProductAnalytics style) ── */}
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
                <p className="text-xs font-medium text-muted-foreground mb-1">عدد الفواتير</p>
                {isLoading ? <Skeleton className="h-7 w-12" /> : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums">{kpi.count}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* إجمالي المبيعات */}
        <Card className="relative overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-transparent pointer-events-none" />
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-blue-500/10 flex items-center justify-center shrink-0 shadow-inner">
                <DollarSign className="w-5 h-5 text-blue-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">إجمالي المبيعات</p>
                {isLoading ? <Skeleton className="h-7 w-20" /> : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums truncate">{fmt(kpi.grossSales)}</p>
                )}
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
                <p className="text-xs font-medium text-muted-foreground mb-1">المرتجعات</p>
                {isLoading ? <Skeleton className="h-7 w-16" /> : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums text-destructive">{fmt(kpi.returnsTotal)}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* صافي المبيعات */}
        <Card className="relative overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent pointer-events-none" />
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 flex items-center justify-center shrink-0 shadow-inner">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">صافي المبيعات</p>
                {isLoading ? <Skeleton className="h-7 w-20" /> : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums truncate">{fmt(kpi.netSales)}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* إجمالي الربح */}
        <Card className="relative overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 pointer-events-none" style={{
            background: kpi.grossProfit >= 0
              ? "linear-gradient(135deg, hsl(152 60% 42% / 0.06) 0%, transparent 60%)"
              : "linear-gradient(135deg, hsl(0 72% 51% / 0.06) 0%, transparent 60%)",
          }} />
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-inner" style={{
                background: kpi.grossProfit >= 0 ? "hsl(152 60% 42% / 0.12)" : "hsl(0 72% 51% / 0.12)",
              }}>
                {kpi.grossProfit >= 0
                  ? <TrendingUp className="w-5 h-5" style={{ color: "hsl(152, 60%, 42%)" }} />
                  : <TrendingDown className="w-5 h-5" style={{ color: "hsl(0, 72%, 51%)" }} />
                }
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">إجمالي الربح</p>
                {isLoading ? <Skeleton className="h-7 w-20" /> : (
                  <p className={`text-2xl font-extrabold tracking-tight tabular-nums truncate ${isPostedOnly ? (kpi.grossProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive") : "text-muted-foreground"}`}>
                    {isPostedOnly ? fmt(kpi.grossProfit) : "—"}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* نسبة التحصيل */}
        <Card className="relative overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent pointer-events-none" />
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-amber-500/10 flex items-center justify-center shrink-0 shadow-inner">
                <Percent className="w-5 h-5 text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">نسبة التحصيل</p>
                {isLoading ? <Skeleton className="h-7 w-16" /> : (
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums">{kpi.collectionRate.toFixed(1)}%</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Chart (for time/customer/product modes) ── */}
      {groupBy !== "invoice" && chartData.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} layout={groupBy === "customer" || groupBy === "product" ? "vertical" : "horizontal"} barSize={groupBy === "time" ? 28 : 20}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={groupBy === "time"} horizontal={groupBy !== "time"} />
                {groupBy === "time" ? (
                  <>
                    <XAxis dataKey="name" fontSize={11} axisLine={false} tickLine={false} />
                    <YAxis fontSize={11} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", fontSize: "12px" }} />
                    <Bar dataKey="مبيعات" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="مرتجعات" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                  </>
                ) : (
                  <>
                    <XAxis type="number" fontSize={11} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" fontSize={11} axisLine={false} tickLine={false} width={100} />
                    <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", fontSize: "12px" }} />
                    <Bar dataKey={groupBy === "customer" ? "المبيعات" : "الإيرادات"} fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </>
                )}
              </BarChart>
            </ResponsiveContainer>
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
          ) : groupBy === "customer" ? (
            <DataTable
              columns={customerColumns}
              data={customerData}
              isLoading={isLoading}
              pageSize={20}
              showPagination
              showSearch
              searchPlaceholder="بحث بالعميل..."
              emptyMessage="لا توجد بيانات"
            />
          ) : groupBy === "product" ? (
            <>
              <DataTable
                columns={productColumns}
                data={productData}
                isLoading={isLoading}
                pageSize={20}
                showPagination
                showSearch
                searchPlaceholder="بحث بالمنتج..."
                emptyMessage="لا توجد بيانات"
              />
              <p className="text-xs text-muted-foreground mt-2 text-center">للتفاصيل الكاملة (التكلفة، الربح، الهوامش) راجع تقرير تحليل المنتجات</p>
            </>
          ) : (
            <DataTable
              columns={timeColumns}
              data={timeData}
              isLoading={isLoading}
              pageSize={31}
              showPagination
              showSearch={false}
              emptyMessage="لا توجد بيانات"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
