import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatProductDisplay } from "@/lib/product-utils";
import { useSettings } from "@/contexts/SettingsContext";
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
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";

const MONTH_NAMES = [
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

interface MonthlyData {
  name: string;
  مبيعات: number;
  مشتريات: number;
}
interface MonthlyExpense {
  name: string;
  مصروفات: number;
}
interface AccountBalance {
  id: string;
  code: string;
  name: string;
  account_type: string;
  debit: number;
  credit: number;
  balance: number;
}
interface UnpaidInvoice {
  id: string;
  invoice_number: number;
  customer_name: string;
  total: number;
  paid_amount: number;
  remaining: number;
}
interface TopProduct {
  product_id: string;
  name: string;
  totalQty: number;
  totalAmount: number;
}
interface LowStockItem {
  name: string;
  brandName: string | null;
  modelNumber: string | null;
  quantity_on_hand: number;
  min_stock_level: number;
}
interface ExpenseByType {
  name: string;
  amount: number;
}
interface RecentActivity {
  id: string;
  title: string;
  subtitle: string;
  amount: number;
  type: "sale" | "purchase" | "expense";
  date: string;
}
interface TopCategory {
  name: string;
  totalSales: number;
  totalProfit: number;
}
interface StagnantItem {
  name: string;
  brandName: string | null;
  modelNumber: string | null;
  quantity_on_hand: number;
  lastMovement: string | null;
}

// ─── Shared helpers ────────────────────────────────────────────────────────────
function EmptyState({ message = "لا توجد بيانات" }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2">
      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
        <Package className="w-5 h-5 text-muted-foreground/40" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
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
        .gte("invoice_date", from.toISOString().slice(0, 10))
        .lte("invoice_date", now.toISOString().slice(0, 10));
      const map: Record<string, { count: number; total: number; paid: number }> = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        map[d.toISOString().slice(0, 10)] = { count: 0, total: 0, paid: 0 };
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
    (s, d) => ({ count: s.count + d.count, total: s.total + d.total, paid: s.paid + d.paid }),
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

  const [loadingKPIs, setLoadingKPIs] = useState(true);
  const [loadingSecondary, setLoadingSecondary] = useState(true);
  const [loadingCharts, setLoadingCharts] = useState(true);
  const [loadingRight, setLoadingRight] = useState(true);
  const [loadingTables, setLoadingTables] = useState(true);

  const [totalSales, setTotalSales] = useState(0);
  const [totalPurchases, setTotalPurchases] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [totalSalesReturns, setTotalSalesReturns] = useState(0);
  const [totalPurchaseReturns, setTotalPurchaseReturns] = useState(0);
  const [totalCOGS, setTotalCOGS] = useState(0);
  const [salesChange, setSalesChange] = useState<number | null>(null);
  const [purchasesChange, setPurchasesChange] = useState<number | null>(null);
  const [expensesChange, setExpensesChange] = useState<number | null>(null);
  const [currentMonthSales, setCurrentMonthSales] = useState(0);
  const [receivables, setReceivables] = useState(0);
  const [payables, setPayables] = useState(0);
  const [inventoryValue, setInventoryValue] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [monthlyExpenses, setMonthlyExpenses] = useState<MonthlyExpense[]>([]);
  const [liquidity, setLiquidity] = useState({ total: 0, cash: 0, bank: 0 });
  const [expensesByType, setExpensesByType] = useState<ExpenseByType[]>([]);
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [unpaidInvoices, setUnpaidInvoices] = useState<UnpaidInvoice[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const [accountBalances, setAccountBalances] = useState<AccountBalance[]>([]);
  const [topCategories, setTopCategories] = useState<TopCategory[]>([]);
  const [stagnantItems, setStagnantItems] = useState<StagnantItem[]>([]);
  const [lastClosingDate, setLastClosingDate] = useState<string | null>(null);

  // Fetch last fiscal year closing date first, then load everything
  useEffect(() => {
    (async () => {
      let closingDate: string | null = null;
      if (settings?.enable_fiscal_year_closing) {
        const { data: closingEntries } = await supabase
          .from("journal_entries")
          .select("entry_date")
          .like("description", "%قيد إقفال السنة المالية%")
          .in("status", ["posted", "approved"])
          .order("entry_date", { ascending: false })
          .limit(1);
        if (closingEntries && closingEntries.length > 0) {
          closingDate = closingEntries[0].entry_date;
          setLastClosingDate(closingDate);
        }
      }
      // Now load data with the closing date awareness
      fetchKPIs(closingDate).finally(() => setLoadingKPIs(false));
      fetchSecondaryKPIs().finally(() => setLoadingSecondary(false));
      fetchCharts(closingDate).finally(() => setLoadingCharts(false));
      Promise.all([fetchLiquidity(), fetchExpensesByType(), fetchRecentActivities()]).finally(() =>
        setLoadingRight(false),
      );
      Promise.all([
        fetchUnpaidInvoices(),
        fetchTopProducts(),
        fetchLowStock(),
        fetchBalances(),
        fetchTopCategories(),
        fetchStagnantStock(),
      ]).finally(() => setLoadingTables(false));
    })();
  }, [settings?.enable_fiscal_year_closing]);

  const fetchKPIs = async (closingDate?: string | null) => {
    const now = new Date();
    const cm = now.getMonth();
    const cy = now.getFullYear();
    // If fiscal year closing exists, start from day after closing; otherwise Jan 1
    const ys = closingDate ? (() => {
      const d = new Date(closingDate);
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    })() : `${cy}-01-01`;
    const ye = `${cy}-12-31`;
    const [sR, pR, eR, srR, prR, cogsR] = await Promise.all([
      supabase
        .from("sales_invoices")
        .select("total, invoice_date")
        .eq("status", "posted")
        .gte("invoice_date", ys)
        .lte("invoice_date", ye),
      supabase
        .from("purchase_invoices")
        .select("total, invoice_date")
        .eq("status", "posted")
        .gte("invoice_date", ys)
        .lte("invoice_date", ye),
      supabase
        .from("expenses")
        .select("amount, expense_date")
        .eq("status", "posted")
        .gte("expense_date", ys)
        .lte("expense_date", ye),
      supabase.from("sales_returns").select("total, return_date").eq("status", "posted")
        .gte("return_date", ys).lte("return_date", ye),
      supabase.from("purchase_returns").select("total, return_date").eq("status", "posted")
        .gte("return_date", ys).lte("return_date", ye),
      supabase
        .from("inventory_movements")
        .select("total_cost, movement_date, movement_type")
        .in("movement_type", ["sale", "sale_return"])
        .gte("movement_date", ys)
        .lte("movement_date", ye),
    ]);
    const sales = sR.data || [];
    const purchases = pR.data || [];
    const expenses = eR.data || [];
    const cogsMovements = cogsR.data || [];
    const sum = (a: any[]) => a.reduce((s, i) => s + Number(i.total || i.amount || 0), 0);
    setTotalSales(sum(sales));
    setTotalPurchases(sum(purchases));
    setTotalExpenses(sum(expenses));
    setTotalSalesReturns(sum(srR.data || []));
    setTotalPurchaseReturns(sum(prR.data || []));
    const saleCost = cogsMovements.filter(m => m.movement_type === "sale").reduce((s, i) => s + Number(i.total_cost || 0), 0);
    const returnCost = cogsMovements.filter(m => m.movement_type === "sale_return").reduce((s, i) => s + Number(i.total_cost || 0), 0);
    setTotalCOGS(saleCost - returnCost);
    setCurrentMonthSales(
      sales
        .filter((i) => {
          const d = new Date(i.invoice_date);
          return d.getMonth() === cm && d.getFullYear() === cy;
        })
        .reduce((s, i) => s + Number(i.total || 0), 0),
    );
    const chg = (items: any[], f: string) => {
      const c = items
        .filter((i) => {
          const d = new Date(i[f]);
          return d.getMonth() === cm && d.getFullYear() === cy;
        })
        .reduce((s, i) => s + Number(i.total || i.amount || 0), 0);
      const pm = cm === 0 ? 11 : cm - 1;
      const py = cm === 0 ? cy - 1 : cy;
      const p = items
        .filter((i) => {
          const d = new Date(i[f]);
          return d.getMonth() === pm && d.getFullYear() === py;
        })
        .reduce((s, i) => s + Number(i.total || i.amount || 0), 0);
      return p > 0 ? ((c - p) / p) * 100 : null;
    };
    setSalesChange(chg(sales, "invoice_date"));
    setPurchasesChange(chg(purchases, "invoice_date"));
    setExpensesChange(chg(expenses, "expense_date"));
  };

  const fetchSecondaryKPIs = async () => {
    const [cR, sR, pR, movR] = await Promise.all([
      supabase.from("customers").select("balance"),
      supabase.from("suppliers").select("balance"),
      supabase.from("products").select("id, quantity_on_hand, min_stock_level, purchase_price").eq("is_active", true),
      // Fetch all purchase/opening movements to calculate weighted avg cost per product
      supabase.from("inventory_movements").select("product_id, quantity, total_cost").in("movement_type", ["purchase", "opening_balance"]),
    ]);
    const products = pR.data || [];
    const movements = movR.data || [];
    setReceivables((cR.data || []).filter((c) => Number(c.balance) > 0).reduce((s, c) => s + Number(c.balance), 0));
    setPayables((sR.data || []).filter((s) => Number(s.balance) > 0).reduce((s2, s) => s2 + Number(s.balance), 0));
    // Calculate inventory value using weighted average cost from movements
    const avgCostMap = new Map<string, number>();
    const prodMovements = new Map<string, { totalQty: number; totalCost: number }>();
    movements.forEach((m: any) => {
      const pid = m.product_id;
      const c = prodMovements.get(pid) || { totalQty: 0, totalCost: 0 };
      c.totalQty += Number(m.quantity);
      c.totalCost += Number(m.total_cost);
      prodMovements.set(pid, c);
    });
    prodMovements.forEach((v, pid) => {
      avgCostMap.set(pid, v.totalQty > 0 ? v.totalCost / v.totalQty : 0);
    });
    setInventoryValue(products.reduce((s, p) => {
      const avgCost = avgCostMap.get(p.id) ?? Number(p.purchase_price);
      return s + Number(p.quantity_on_hand) * avgCost;
    }, 0));
    setLowStockCount(
      products.filter((p) => Number(p.quantity_on_hand) <= Number(p.min_stock_level) && Number(p.min_stock_level) > 0)
        .length,
    );
  };

  const fetchCharts = async (closingDate?: string | null) => {
    const y = new Date().getFullYear();
    const chartStart = closingDate ? (() => {
      const d = new Date(closingDate);
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    })() : `${y}-01-01`;
    const [sR, pR, eR] = await Promise.all([
      supabase
        .from("sales_invoices")
        .select("invoice_date, total")
        .eq("status", "posted")
        .gte("invoice_date", chartStart)
        .lte("invoice_date", `${y}-12-31`),
      supabase
        .from("purchase_invoices")
        .select("invoice_date, total")
        .eq("status", "posted")
        .gte("invoice_date", chartStart)
        .lte("invoice_date", `${y}-12-31`),
      supabase
        .from("expenses")
        .select("expense_date, amount")
        .eq("status", "posted")
        .gte("expense_date", chartStart)
        .lte("expense_date", `${y}-12-31`),
    ]);
    const m: MonthlyData[] = MONTH_NAMES.map((n) => ({ name: n, مبيعات: 0, مشتريات: 0 }));
    const me: MonthlyExpense[] = MONTH_NAMES.map((n) => ({ name: n, مصروفات: 0 }));
    (sR.data || []).forEach((i) => {
      m[new Date(i.invoice_date).getMonth()].مبيعات += Number(i.total);
    });
    (pR.data || []).forEach((i) => {
      m[new Date(i.invoice_date).getMonth()].مشتريات += Number(i.total);
    });
    (eR.data || []).forEach((i) => {
      me[new Date(i.expense_date).getMonth()].مصروفات += Number(i.amount);
    });
    const cm = new Date().getMonth();
    setMonthlyData(m.slice(0, cm + 1));
    setMonthlyExpenses(me.slice(0, cm + 1));
  };

  const fetchLiquidity = async () => {
    const [aR, lR] = await Promise.all([
      supabase.from("accounts").select("id, code, name").eq("is_active", true),
      supabase.from("journal_entry_lines").select("account_id, debit, credit, journal_entry_id").limit(5000),
    ]);
    if (!aR.data || !lR.data) return;
    const cash = aR.data.filter((a) => a.code.startsWith("1101"));
    const bank = aR.data.filter((a) => a.code.startsWith("1102"));
    const allIds = new Set([...cash, ...bank].map((a) => a.id));
    const eIds = [...new Set(lR.data.map((l: any) => l.journal_entry_id))];
    if (!eIds.length) return;
    const { data: entries } = await supabase.from("journal_entries").select("id").in("id", eIds).eq("status", "posted");
    const posted = new Set((entries || []).map((e) => e.id));
    const cIds = new Set(cash.map((a) => a.id));
    const bIds = new Set(bank.map((a) => a.id));
    let cb = 0,
      bb = 0;
    lR.data.forEach((l: any) => {
      if (!posted.has(l.journal_entry_id) || !allIds.has(l.account_id)) return;
      const net = Number(l.debit) - Number(l.credit);
      if (cIds.has(l.account_id)) cb += net;
      if (bIds.has(l.account_id)) bb += net;
    });
    setLiquidity({ total: cb + bb, cash: cb, bank: bb });
  };

  const fetchExpensesByType = async () => {
    const [eR, tR] = await Promise.all([
      supabase.from("expenses").select("expense_type_id, amount").eq("status", "posted"),
      supabase.from("expense_types").select("id, name"),
    ]);
    const tm = new Map((tR.data || []).map((t) => [t.id, t.name]));
    const g = new Map<string, number>();
    (eR.data || []).forEach((e) => {
      const n = tm.get(e.expense_type_id) || "أخرى";
      g.set(n, (g.get(n) || 0) + Number(e.amount));
    });
    setExpensesByType(
      Array.from(g.entries())
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5),
    );
  };

  const fetchRecentActivities = async () => {
    const [sR, pR] = await Promise.all([
      supabase
        .from("sales_invoices")
        .select("id, invoice_number, total, invoice_date, customer_id")
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("purchase_invoices")
        .select("id, invoice_number, total, invoice_date, supplier_id")
        .order("created_at", { ascending: false })
        .limit(2),
    ]);
    const acts: RecentActivity[] = [];
    if (sR.data?.length) {
      const ids = [...new Set(sR.data.filter((d) => d.customer_id).map((d) => d.customer_id!))];
      const { data: custs } = ids.length
        ? await supabase.from("customers").select("id, name").in("id", ids)
        : { data: [] };
      const cm = new Map((custs || []).map((c) => [c.id, c.name]));
      sR.data.forEach((inv) =>
        acts.push({
          id: inv.id,
          title: `فاتورة مبيعات #${inv.invoice_number}`,
          subtitle: cm.get(inv.customer_id || "") || "عميل نقدي",
          amount: Number(inv.total),
          type: "sale",
          date: inv.invoice_date,
        }),
      );
    }
    if (pR.data?.length) {
      const ids = [...new Set(pR.data.filter((d) => d.supplier_id).map((d) => d.supplier_id!))];
      const { data: supps } = ids.length
        ? await supabase.from("suppliers").select("id, name").in("id", ids)
        : { data: [] };
      const sm = new Map((supps || []).map((s) => [s.id, s.name]));
      pR.data.forEach((inv) =>
        acts.push({
          id: inv.id,
          title: `فاتورة مشتريات #${inv.invoice_number}`,
          subtitle: sm.get(inv.supplier_id || "") || "مورد",
          amount: Number(inv.total),
          type: "purchase",
          date: inv.invoice_date,
        }),
      );
    }
    acts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setRecentActivities(acts.slice(0, 4));
  };

  const fetchUnpaidInvoices = async () => {
    const { data } = await supabase
      .from("sales_invoices")
      .select("id, invoice_number, total, paid_amount, customer_id")
      .eq("status", "posted")
      .order("created_at", { ascending: false })
      .limit(100);
    if (!data) return;
    const unpaid = data.filter((inv) => Number(inv.paid_amount) < Number(inv.total));
    const ids = [...new Set(unpaid.filter((d) => d.customer_id).map((d) => d.customer_id!))];
    const { data: custs } = ids.length
      ? await supabase.from("customers").select("id, name").in("id", ids)
      : { data: [] };
    const cm = new Map((custs || []).map((c) => [c.id, c.name]));
    setUnpaidInvoices(
      unpaid.slice(0, 10).map((inv) => ({
        id: inv.id,
        invoice_number: inv.invoice_number,
        customer_name: cm.get(inv.customer_id || "") || "عميل نقدي",
        total: Number(inv.total),
        paid_amount: Number(inv.paid_amount),
        remaining: Number(inv.total) - Number(inv.paid_amount),
      })),
    );
  };

  const fetchTopProducts = async () => {
    const { data: items } = await (supabase.from("sales_invoice_items") as any).select(
      "product_id, quantity, total, net_total, invoice_id",
    );
    if (!items?.length) return;
    const iIds = [...new Set(items.map((i: any) => i.invoice_id))] as string[];
    const { data: invs } = await supabase.from("sales_invoices").select("id").in("id", iIds).eq("status", "posted");
    const posted = new Set((invs || []).map((i) => i.id));
    const g = new Map<string, { qty: number; amount: number }>();
    items.forEach((item: any) => {
      if (!posted.has(item.invoice_id) || !item.product_id) return;
      const c = g.get(item.product_id) || { qty: 0, amount: 0 };
      c.qty += Number(item.quantity);
      c.amount += Number(item.net_total || item.total);
      g.set(item.product_id, c);
    });
    const pIds = [...g.keys()] as string[];
    const { data: prods } = await (supabase.from("products") as any)
      .select("id, name, model_number, product_brands(name)")
      .in("id", pIds);
    const pm = new Map(
      (prods || []).map((p: any) => [p.id, formatProductDisplay(p.name, p.product_brands?.name, p.model_number)]),
    );
    setTopProducts(
      Array.from(g.entries())
        .map(([pid, d]) => ({
          product_id: pid,
          name: (pm.get(pid) as string) || "منتج",
          totalQty: d.qty,
          totalAmount: d.amount,
        }))
        .sort((a, b) => b.totalAmount - a.totalAmount)
        .slice(0, 10),
    );
  };

  const fetchLowStock = async () => {
    const { data } = await (supabase.from("products") as any)
      .select("name, quantity_on_hand, min_stock_level, model_number, product_brands(name)")
      .eq("is_active", true)
      .order("quantity_on_hand", { ascending: true })
      .limit(20);
    setLowStockItems(
      (data || [])
        .filter((p: any) => Number(p.quantity_on_hand) <= Number(p.min_stock_level) && Number(p.min_stock_level) > 0)
        .map((p: any) => ({
          name: p.name,
          brandName: p.product_brands?.name || null,
          modelNumber: p.model_number || null,
          quantity_on_hand: Number(p.quantity_on_hand),
          min_stock_level: Number(p.min_stock_level),
        })),
    );
  };

  const fetchBalances = async () => {
    const [aR, lR] = await Promise.all([
      supabase
        .from("accounts")
        .select("id, code, name, account_type")
        .eq("is_active", true)
        .eq("is_parent", false)
        .order("code"),
      supabase.from("journal_entry_lines").select("account_id, debit, credit, journal_entry_id").limit(5000),
    ]);
    if (!aR.data || !lR.data) return;
    const eIds = [...new Set(lR.data.map((l: any) => l.journal_entry_id))];
    if (!eIds.length) return;
    const { data: entries } = await supabase.from("journal_entries").select("id").in("id", eIds).eq("status", "posted");
    const posted = new Set((entries || []).map((e) => e.id));
    const bm = new Map<string, { debit: number; credit: number }>();
    lR.data.forEach((l: any) => {
      if (!posted.has(l.journal_entry_id)) return;
      const c = bm.get(l.account_id) || { debit: 0, credit: 0 };
      c.debit += Number(l.debit);
      c.credit += Number(l.credit);
      bm.set(l.account_id, c);
    });
    setAccountBalances(
      aR.data
        .filter((a: any) => bm.has(a.id))
        .map((a: any) => {
          const b = bm.get(a.id)!;
          return { ...a, debit: b.debit, credit: b.credit, balance: b.debit - b.credit };
        }),
    );
  };

  const fetchTopCategories = async () => {
    const { data: items } = await (supabase.from("sales_invoice_items") as any).select(
      "product_id, quantity, total, net_total, invoice_id",
    );
    if (!items?.length) {
      setTopCategories([]);
      return;
    }
    const iIds = [...new Set(items.map((i: any) => i.invoice_id))] as string[];
    const { data: invs } = await supabase.from("sales_invoices").select("id").in("id", iIds).eq("status", "posted");
    const posted = new Set((invs || []).map((i) => i.id));
    const pIds = [
      ...new Set(items.filter((i: any) => i.product_id && posted.has(i.invoice_id)).map((i: any) => i.product_id)),
    ] as string[];
    if (!pIds.length) {
      setTopCategories([]);
      return;
    }
    const { data: prods } = await supabase
      .from("products")
      .select("id, category_id, purchase_price")
      .in("id", pIds as string[]);
    const { data: cats } = await supabase.from("product_categories").select("id, name");
    const pm = new Map((prods || []).map((p) => [p.id, p]));
    const cm = new Map((cats || []).map((c) => [c.id, c.name]));
    const g = new Map<string, { sales: number; profit: number }>();
    items.forEach((item: any) => {
      if (!posted.has(item.invoice_id) || !item.product_id) return;
      const prod = pm.get(item.product_id);
      if (!prod) return;
      const cat = prod.category_id ? cm.get(prod.category_id) || "بدون تصنيف" : "بدون تصنيف";
      const c = g.get(cat) || { sales: 0, profit: 0 };
      c.sales += Number(item.net_total || item.total);
      c.profit += Number(item.net_total || item.total) - Number(prod.purchase_price) * Number(item.quantity);
      g.set(cat, c);
    });
    setTopCategories(
      Array.from(g.entries())
        .map(([name, d]) => ({ name, totalSales: d.sales, totalProfit: d.profit }))
        .sort((a, b) => b.totalSales - a.totalSales)
        .slice(0, 8),
    );
  };

  const fetchStagnantStock = async () => {
    const { data: prods } = await (supabase.from("products") as any)
      .select("id, name, quantity_on_hand, model_number, product_brands(name)")
      .eq("is_active", true)
      .gt("quantity_on_hand", 0);
    if (!prods?.length) {
      setStagnantItems([]);
      return;
    }
    const pIds = prods.map((p: any) => p.id);
    const { data: moves } = await supabase
      .from("inventory_movements")
      .select("product_id, movement_date")
      .in("product_id", pIds)
      .order("movement_date", { ascending: false });
    const lm = new Map<string, string>();
    (moves || []).forEach((m: any) => {
      if (!lm.has(m.product_id)) lm.set(m.product_id, m.movement_date);
    });
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    setStagnantItems(
      prods
        .filter((p: any) => {
          const d = lm.get(p.id);
          return !d || new Date(d) < cutoff;
        })
        .map((p: any) => ({
          name: p.name,
          brandName: p.product_brands?.name || null,
          modelNumber: p.model_number || null,
          quantity_on_hand: Number(p.quantity_on_hand),
          lastMovement: lm.get(p.id) || null,
        }))
        .sort((a: StagnantItem, b: StagnantItem) => {
          if (!a.lastMovement) return -1;
          if (!b.lastMovement) return 1;
          return new Date(a.lastMovement).getTime() - new Date(b.lastMovement).getTime();
        })
        .slice(0, 10),
    );
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const netSales = totalSales - totalSalesReturns;
  const netPurchases = totalPurchases - totalPurchaseReturns;
  const grossProfit = netSales - totalCOGS;
  const netProfit = grossProfit - totalExpenses;
  const profitMargin = netSales > 0 ? ((netProfit / netSales) * 100).toFixed(1) : "0";

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

  const todayLabel = new Intl.DateTimeFormat("ar-SA", {
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
      label: "صافي الربح",
      value: netProfit,
      extraLabel: `${netProfit >= 0 ? "هامش الربح" : "هامش الخسارة"} ${profitMargin}%`,
      icon: netProfit >= 0 ? TrendingUp : TrendingDown,
      iconBg: netProfit >= 0 ? "bg-emerald-500/10" : "bg-destructive/10",
      iconColor: netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
      valueColor: netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
      accent: netProfit >= 0 ? "bg-emerald-500" : "bg-destructive",
    },
    {
      label: "إجمالي المصروفات",
      value: totalExpenses,
      change: expensesChange,
      icon: ReceiptText,
      iconBg: "bg-destructive/10",
      iconColor: "text-destructive",
      accent: "bg-destructive",
    },
  ];

  const secondaryCards = [
    { label: "المستحقات", icon: Users, iconBg: "bg-primary/10", iconColor: "text-primary", value: receivables },
    { label: "المطلوبات", icon: Landmark, iconBg: "bg-amber-500/10", iconColor: "text-amber-500", value: payables },
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
      {/* ═══════════════════════════════════════════════════════════════════════
          PAGE HEADER
         ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between gap-4 pb-6 border-b border-border/40 mb-8 sticky top-16 z-10 bg-background backdrop-blur-sm border-b border-border py-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0 shadow-inner">
            <LayoutDashboard className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight leading-tight">لوحة التحكم</h1>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <Clock className="w-3 h-3 shrink-0" />
              {todayLabel}
            </p>
          </div>
        </div>
        {!loadingKPIs && (
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
        )}
      </div>

      {/* ─── Zone divider helper (inline) ────────────────────────────────── */}
      {/* We use a local pattern: label over a rule */}

      {/* ═══════════════════════════════════════════════════════════════════════
          ZONE 1 — الملخص المالي
         ═══════════════════════════════════════════════════════════════════════ */}
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

      {/* ═══════════════════════════════════════════════════════════════════════
          ZONE 2 — الاتجاهات والتحليل
          Layout: charts 2/3 · sidebar 1/3
         ═══════════════════════════════════════════════════════════════════════ */}
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
              <CardContent>
                {loadingCharts ? (
                  <Skeleton className="h-[240px] w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={monthlyData.slice(-6)} barSize={28}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.5} />
                      <XAxis dataKey="name" fontSize={11} axisLine={false} tickLine={false} />
                      <YAxis fontSize={10} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", fontSize: "12px" }}
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
              <CardContent>
                {loadingCharts ? (
                  <Skeleton className="h-[180px] w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={274}>
                    <LineChart data={monthlyExpenses.slice(-6)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.5} />
                      <XAxis dataKey="name" fontSize={11} axisLine={false} tickLine={false} />
                      <YAxis fontSize={10} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", fontSize: "12px" }}
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

            {/* Sales Target */}
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
                          <span className="text-xs text-muted-foreground">المحقق</span>
                          <span
                            className={`text-sm font-bold tabular-nums ${exceeded ? "text-emerald-600 dark:text-emerald-400" : ""}`}
                          >
                            {formatCurrency(currentMonthSales)}
                          </span>
                        </div>
                        <Progress value={progress} className="h-2" />
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
                <button
                  onClick={() => navigate("/sales")}
                  className="text-xs text-primary/80 hover:text-primary font-medium flex items-center gap-0.5 transition-colors"
                >
                  عرض الكل
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
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
                          {formatDistanceToNow(new Date(act.date), { addSuffix: true, locale: ar })}
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

      {/* ═══════════════════════════════════════════════════════════════════════
          ZONE 3 — التنبيهات والمتابعة
          Layout: 2 cols (unpaid · low stock) then stagnant full-width
         ═══════════════════════════════════════════════════════════════════════ */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 rounded-full bg-destructive" />
            <h2 className="text-sm font-bold text-foreground">التنبيهات والمتابعة</h2>
          </div>
          <div className="flex-1 h-px bg-border/50" />
          <p className="text-[11px] text-muted-foreground shrink-0">تستوجب إجراءً</p>
        </div>

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
                        <TableCell className="font-mono text-xs text-muted-foreground">#{inv.invoice_number}</TableCell>
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
                    {lowStockItems.map((item) => (
                      <TableRow key={item.name} className={tr}>
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
                    {stagnantItems.map((item) => (
                      <TableRow key={item.name} className={tr}>
                        <TableCell className="text-sm font-medium">
                          {formatProductDisplay(item.name, item.brandName, item.modelNumber)}
                        </TableCell>
                        <TableCell className="text-sm text-center tabular-nums">{item.quantity_on_hand}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {item.lastMovement ? (
                            formatDistanceToNow(new Date(item.lastMovement), { addSuffix: true, locale: ar })
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

      {/* ═══════════════════════════════════════════════════════════════════════
          ZONE 4 — أداء المبيعات
          Layout: last-7-days full-width · then products + categories 2-col
         ═══════════════════════════════════════════════════════════════════════ */}
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

      {/* ═══════════════════════════════════════════════════════════════════════
          ZONE 5 — التفاصيل المالية
          Layout: expenses 1/3 · account balances 2/3
         ═══════════════════════════════════════════════════════════════════════ */}
      <div>
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 rounded-full bg-amber-500" />
            <h2 className="text-sm font-bold text-foreground">التفاصيل المالية</h2>
          </div>
          <div className="flex-1 h-px bg-border/50" />
          <button
            onClick={() => navigate("/reports")}
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
                            <div className={`w-9 h-9 rounded-xl ${g.iconBg} flex items-center justify-center shrink-0`}>
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
    </div>
  );
}
