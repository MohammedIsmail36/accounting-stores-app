import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/contexts/SettingsContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DatePickerInput } from "@/components/DatePickerInput";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  ShoppingCart,
  Receipt,
  BarChart3,
  Percent,
  FileSpreadsheet,
  FileText,
  Users,
  Package,
  RotateCcw,
  Info,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  differenceInCalendarDays,
  eachMonthOfInterval,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";
import { ar } from "date-fns/locale";
import { toWesternDigits } from "@/lib/utils";
import { exportToExcel } from "@/lib/excel-export";
import { exportReportPdf } from "@/lib/report-pdf";
import {
  REPORT_ENTRY_STATUSES,
  excludeClosingEntries,
} from "@/lib/report-period";


const CHART_COLORS = [
  "hsl(24, 95%, 53%)", // primary orange
  "hsl(152, 60%, 42%)", // success green
  "hsl(217, 80%, 50%)", // blue
  "hsl(340, 65%, 50%)", // pink
  "hsl(262, 60%, 50%)", // purple
  "hsl(38, 92%, 50%)", // warning yellow
];

export default function GrowthAnalytics() {
  const { formatCurrency, settings } = useSettings();
  const [quickRange, setQuickRange] = useState("6");
  const [dateFrom, setDateFrom] = useState(
    format(startOfMonth(subMonths(new Date(), 5)), "yyyy-MM-dd"),
  );
  const [dateTo, setDateTo] = useState(
    format(endOfMonth(new Date()), "yyyy-MM-dd"),
  );

  const fromDate = parseISO(dateFrom);
  const toDate = parseISO(dateTo);
  const dateRangeInvalid = dateFrom > dateTo;
  const periodDays = Math.max(
    1,
    differenceInCalendarDays(toDate, fromDate) + 1,
  );
  const prevToDate = subDays(fromDate, 1);
  const prevFromDate = subDays(prevToDate, periodDays - 1);
  const prevFrom = format(prevFromDate, "yyyy-MM-dd");
  const prevTo = format(prevToDate, "yyyy-MM-dd");

  const applyQuickRange = (value: string) => {
    if (value === "custom") {
      setQuickRange("custom");
      return;
    }
    const parsedMonths = parseInt(value, 10);
    if (Number.isNaN(parsedMonths) || parsedMonths <= 0) return;
    setQuickRange(value);
    setDateFrom(
      format(
        startOfMonth(subMonths(new Date(), parsedMonths - 1)),
        "yyyy-MM-dd",
      ),
    );
    setDateTo(format(endOfMonth(new Date()), "yyyy-MM-dd"));
  };

  const handleDateFromChange = (value: string) => {
    setQuickRange("custom");
    setDateFrom(value);
    if (value > dateTo) setDateTo(value);
  };

  const handleDateToChange = (value: string) => {
    setQuickRange("custom");
    setDateTo(value);
    if (value < dateFrom) setDateFrom(value);
  };

  // --- Data Queries ---

  const { data: salesData, isLoading: loadingSales } = useQuery({
    queryKey: ["growth-sales-invoices", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select("id, invoice_date, total, paid_amount, status")
        .gte("invoice_date", dateFrom)
        .lte("invoice_date", dateTo)
        .eq("status", "posted");
      if (error) throw error;
      return data;
    },
  });

  const { data: purchasesData, isLoading: loadingPurchases } = useQuery({
    queryKey: ["growth-purchases-invoices", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_invoices")
        .select("id, invoice_date, total, status")
        .gte("invoice_date", dateFrom)
        .lte("invoice_date", dateTo)
        .eq("status", "posted");
      if (error) throw error;
      return data;
    },
  });

  const { data: expensesData, isLoading: loadingExpenses } = useQuery({
    queryKey: ["growth-expenses", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("expense_date, amount, status")
        .gte("expense_date", dateFrom)
        .lte("expense_date", dateTo)
        .eq("status", "posted");
      if (error) throw error;
      return data;
    },
  });

  const { data: prevExpensesData, isLoading: loadingPrevExpenses } = useQuery({
    queryKey: ["growth-prev-expenses", prevFrom, prevTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("amount")
        .gte("expense_date", prevFrom)
        .lte("expense_date", prevTo)
        .eq("status", "posted");
      if (error) throw error;
      return data;
    },
  });

  const { data: customersData } = useQuery({
    queryKey: ["growth-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, balance")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  // Sales items (ex-VAT, net of invoice discounts via net_total)
  const { data: salesItemsData, isLoading: loadingSalesItems } = useQuery({
    queryKey: ["growth-sales-items", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoice_items")
        .select(
          "product_id, quantity, total, net_total, product:products(name), invoice:sales_invoices!inner(invoice_date, status)",
        )
        .gte("invoice.invoice_date", dateFrom)
        .lte("invoice.invoice_date", dateTo)
        .eq("invoice.status", "posted");
      if (error) throw error;
      return data;
    },
  });

  const { data: prevSalesItemsData, isLoading: loadingPrevSalesItems } =
    useQuery({
      queryKey: ["growth-prev-sales-items", prevFrom, prevTo],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("sales_invoice_items")
          .select(
            "quantity, total, net_total, invoice:sales_invoices!inner(invoice_date, status)",
          )
          .gte("invoice.invoice_date", prevFrom)
          .lte("invoice.invoice_date", prevTo)
          .eq("invoice.status", "posted");
        if (error) throw error;
        return data;
      },
    });

  // Sales returns at item level (aligned with sales items for net sales analysis)
  const { data: salesReturnItemsData, isLoading: loadingSalesReturnItems } =
    useQuery({
      queryKey: ["growth-sales-return-items", dateFrom, dateTo],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("sales_return_items")
          .select(
            "product_id, quantity, total, product:products(name), return:sales_returns!inner(return_date, status)",
          )
          .gte("return.return_date", dateFrom)
          .lte("return.return_date", dateTo)
          .eq("return.status", "posted");
        if (error) throw error;
        return data;
      },
    });

  const {
    data: prevSalesReturnItemsData,
    isLoading: loadingPrevSalesReturnItems,
  } = useQuery({
    queryKey: ["growth-prev-sales-return-items", prevFrom, prevTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_return_items")
        .select(
          "quantity, total, return:sales_returns!inner(return_date, status)",
        )
        .gte("return.return_date", prevFrom)
        .lte("return.return_date", prevTo)
        .eq("return.status", "posted");
      if (error) throw error;
      return data;
    },
  });

  // Purchase items (used as operational procurement trend, not COGS)
  const { data: purchaseItemsData, isLoading: loadingPurchaseItems } = useQuery(
    {
      queryKey: ["growth-purchase-items", dateFrom, dateTo],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("purchase_invoice_items")
          .select(
            "quantity, total, net_total, invoice:purchase_invoices!inner(invoice_date, status)",
          )
          .gte("invoice.invoice_date", dateFrom)
          .lte("invoice.invoice_date", dateTo)
          .eq("invoice.status", "posted");
        if (error) throw error;
        return data;
      },
    },
  );

  const { data: prevPurchaseItemsData, isLoading: loadingPrevPurchaseItems } =
    useQuery({
      queryKey: ["growth-prev-purchase-items", prevFrom, prevTo],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("purchase_invoice_items")
          .select(
            "quantity, total, net_total, invoice:purchase_invoices!inner(invoice_date, status)",
          )
          .gte("invoice.invoice_date", prevFrom)
          .lte("invoice.invoice_date", prevTo)
          .eq("invoice.status", "posted");
        if (error) throw error;
        return data;
      },
    });

  const {
    data: purchaseReturnItemsData,
    isLoading: loadingPurchaseReturnItems,
  } = useQuery({
    queryKey: ["growth-purchase-return-items", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_return_items")
        .select(
          "quantity, total, return:purchase_returns!inner(return_date, status)",
        )
        .gte("return.return_date", dateFrom)
        .lte("return.return_date", dateTo)
        .eq("return.status", "posted");
      if (error) throw error;
      return data;
    },
  });

  const {
    data: prevPurchaseReturnItemsData,
    isLoading: loadingPrevPurchaseReturnItems,
  } = useQuery({
    queryKey: ["growth-prev-purchase-return-items", prevFrom, prevTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_return_items")
        .select("total, return:purchase_returns!inner(return_date, status)")
        .gte("return.return_date", prevFrom)
        .lte("return.return_date", prevTo)
        .eq("return.status", "posted");
      if (error) throw error;
      return data;
    },
  });

  // Cost of goods sold from inventory movements (authoritative source)
  const { data: cogsData, isLoading: loadingCogs } = useQuery({
    queryKey: ["growth-cogs", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("movement_type, total_cost, movement_date")
        .in("movement_type", ["sale", "sale_return"])
        .gte("movement_date", dateFrom)
        .lte("movement_date", dateTo);
      if (error) throw error;
      return data;
    },
  });

  const { data: prevCogsData, isLoading: loadingPrevCogs } = useQuery({
    queryKey: ["growth-prev-cogs", prevFrom, prevTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("movement_type, total_cost, movement_date")
        .in("movement_type", ["sale", "sale_return"])
        .gte("movement_date", prevFrom)
        .lte("movement_date", prevTo);
      if (error) throw error;
      return data;
    },
  });

  // Header-level returns (counts + receivable collection context)
  const { data: salesReturnsData, isLoading: loadingSalesReturnsHeaders } =
    useQuery({
      queryKey: ["growth-sales-returns-headers", dateFrom, dateTo],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("sales_returns")
          .select("return_date, total, status")
          .gte("return_date", dateFrom)
          .lte("return_date", dateTo)
          .eq("status", "posted");
        if (error) throw error;
        return data;
      },
    });

  const {
    data: purchaseReturnsData,
    isLoading: loadingPurchaseReturnsHeaders,
  } = useQuery({
    queryKey: ["growth-purchase-returns-headers", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_returns")
        .select("total")
        .gte("return_date", dateFrom)
        .lte("return_date", dateTo)
        .eq("status", "posted");
      if (error) throw error;
      return data;
    },
  });

  // Reconciliation bridge: operating report vs accounting income statement.
  const { data: accountingBridgeData, isLoading: loadingAccountingBridge } =
    useQuery({
      queryKey: ["growth-accounting-bridge", dateFrom, dateTo],
      queryFn: async () => {
        const { data: accounts, error: accountsError } = await supabase
          .from("accounts")
          .select("id, code, account_type")
          .eq("is_active", true)
          .eq("is_parent", false)
          .in("account_type", ["revenue", "expense"]);
        if (accountsError) throw accountsError;

        if (!accounts?.length) {
          return {
            revenue: 0,
            expenses: 0,
            netIncome: 0,
            inventoryGain: 0,
            inventoryLoss: 0,
          };
        }

        const accountMap = new Map(
          accounts.map((account: any) => [account.id, account]),
        );
        const accountIds = accounts.map((account: any) => account.id);

        const { data: lines, error: linesError } = await supabase
          .from("journal_entry_lines")
          .select(
            "account_id, debit, credit, journal_entries!inner(entry_date, status, description)",
          )
          .in("account_id", accountIds)
          .in("journal_entries.status", [...REPORT_ENTRY_STATUSES])
          .gte("journal_entries.entry_date", dateFrom)
          .lte("journal_entries.entry_date", dateTo);
        if (linesError) throw linesError;

        let revenue = 0;
        let expenses = 0;
        let inventoryGain = 0;
        let inventoryLoss = 0;

        // استثناء قيود الإقفال السنوي من جسر المطابقة المحاسبي
        excludeClosingEntries((lines || []) as any[]).forEach((line: any) => {

          const account = accountMap.get(line.account_id);
          if (!account) return;

          const debit = Number(line.debit || 0);
          const credit = Number(line.credit || 0);

          if (account.account_type === "revenue") {
            const amount = credit - debit;
            revenue += amount;
            if (account.code === "4201") inventoryGain += amount;
          } else if (account.account_type === "expense") {
            const amount = debit - credit;
            expenses += amount;
            if (account.code === "5201") inventoryLoss += amount;
          }
        });

        return {
          revenue,
          expenses,
          netIncome: revenue - expenses,
          inventoryGain,
          inventoryLoss,
        };
      },
    });

  // --- Calculations ---

  const sumNetItemTotal = (items: any[] | null | undefined) =>
    items?.reduce(
      (sum, item) => sum + Number(item?.net_total ?? item?.total ?? 0),
      0,
    ) ?? 0;

  const sumItemTotal = (items: any[] | null | undefined) =>
    items?.reduce((sum, item) => sum + Number(item?.total ?? 0), 0) ?? 0;

  const calcCogsTotal = (movements: any[] | null | undefined) =>
    movements?.reduce((sum, movement) => {
      const cost = Number(movement?.total_cost ?? 0);
      if (movement?.movement_type === "sale") return sum + cost;
      if (movement?.movement_type === "sale_return") return sum - cost;
      return sum;
    }, 0) ?? 0;

  const relationDate = (
    item: any,
    relationKey: "invoice" | "return",
    dateKey: "invoice_date" | "return_date",
  ): string | null => {
    const relation = item?.[relationKey];
    if (Array.isArray(relation)) return relation[0]?.[dateKey] ?? null;
    return relation?.[dateKey] ?? null;
  };

  const productName = (item: any) => {
    const relation = item?.product;
    if (Array.isArray(relation)) return relation[0]?.name || "Other";
    return relation?.name || "Other";
  };

  // Item-level totals are ex-VAT and include line-level net discounts when available.
  const totalSales = sumNetItemTotal(salesItemsData as any[] | undefined);
  const prevTotalSales = sumNetItemTotal(
    prevSalesItemsData as any[] | undefined,
  );

  const totalSalesReturns = sumItemTotal(
    salesReturnItemsData as any[] | undefined,
  );
  const prevTotalSalesReturns = sumItemTotal(
    prevSalesReturnItemsData as any[] | undefined,
  );

  const netSales = totalSales - totalSalesReturns;
  const prevNetSales = prevTotalSales - prevTotalSalesReturns;

  const totalPurchases = sumNetItemTotal(
    purchaseItemsData as any[] | undefined,
  );
  const prevTotalPurchases = sumNetItemTotal(
    prevPurchaseItemsData as any[] | undefined,
  );

  const totalPurchaseReturns = sumItemTotal(
    purchaseReturnItemsData as any[] | undefined,
  );
  const prevTotalPurchaseReturns = sumItemTotal(
    prevPurchaseReturnItemsData as any[] | undefined,
  );

  const netPurchases = totalPurchases - totalPurchaseReturns;
  const prevNetPurchases = prevTotalPurchases - prevTotalPurchaseReturns;

  const totalExpenses =
    expensesData?.reduce((sum, expense) => sum + Number(expense.amount), 0) ??
    0;
  const prevTotalExpenses =
    prevExpensesData?.reduce(
      (sum, expense) => sum + Number(expense.amount),
      0,
    ) ?? 0;

  const cogs = calcCogsTotal(cogsData as any[] | undefined);
  const prevCogs = calcCogsTotal(prevCogsData as any[] | undefined);

  // Gross profit = Net Sales - COGS.
  const grossProfit = netSales - cogs;
  const prevGrossProfit = prevNetSales - prevCogs;
  const grossMargin = netSales > 0 ? (grossProfit / netSales) * 100 : 0;

  // Net profit = Gross Profit - Operating Expenses.
  const netProfit = grossProfit - totalExpenses;
  const prevNetProfit = prevGrossProfit - prevTotalExpenses;
  const netMargin = netSales > 0 ? (netProfit / netSales) * 100 : 0;

  const accountingRevenue = accountingBridgeData?.revenue ?? 0;
  const accountingExpenses = accountingBridgeData?.expenses ?? 0;
  const accountingNetProfit = accountingBridgeData?.netIncome ?? 0;
  const inventoryAdjustmentGain = accountingBridgeData?.inventoryGain ?? 0;
  const inventoryAdjustmentLoss = accountingBridgeData?.inventoryLoss ?? 0;
  const inventoryAdjustmentsNet =
    inventoryAdjustmentGain - inventoryAdjustmentLoss;
  const bridgeDifference = accountingNetProfit - netProfit;
  const otherAccountingAdjustments = bridgeDifference - inventoryAdjustmentsNet;
  const accountingMargin =
    accountingRevenue > 0 ? (accountingNetProfit / accountingRevenue) * 100 : 0;

  const avgInvoice =
    (salesData?.length ?? 0) > 0 ? totalSales / (salesData?.length ?? 1) : 0;

  const calcGrowth = (current: number, prev: number) => {
    if (prev === 0) return current > 0 ? 100 : current < 0 ? -100 : 0;
    return ((current - prev) / Math.abs(prev)) * 100;
  };

  // --- Monthly chart data ---
  const chartData = useMemo(() => {
    const monthlyData: Record<
      string,
      {
        month: string;
        sales: number;
        salesReturns: number;
        purchases: number;
        purchaseReturns: number;
        cogs: number;
        expenses: number;
        grossProfit: number;
        netProfit: number;
      }
    > = {};

    const chartMonths = eachMonthOfInterval({
      start: startOfMonth(parseISO(dateFrom)),
      end: startOfMonth(parseISO(dateTo)),
    });

    chartMonths.forEach((d) => {
      const key = format(d, "yyyy-MM");
      const label = toWesternDigits(format(d, "MMM yyyy", { locale: ar }));
      monthlyData[key] = {
        month: label,
        sales: 0,
        salesReturns: 0,
        purchases: 0,
        purchaseReturns: 0,
        cogs: 0,
        expenses: 0,
        grossProfit: 0,
        netProfit: 0,
      };
    });

    (salesItemsData as any[] | undefined)?.forEach((item) => {
      const invoiceDate = relationDate(item, "invoice", "invoice_date");
      if (!invoiceDate) return;
      const key = invoiceDate.substring(0, 7);
      if (monthlyData[key])
        monthlyData[key].sales += Number(item?.net_total ?? item?.total ?? 0);
    });

    (salesReturnItemsData as any[] | undefined)?.forEach((item) => {
      const returnDate = relationDate(item, "return", "return_date");
      if (!returnDate) return;
      const key = returnDate.substring(0, 7);
      if (monthlyData[key])
        monthlyData[key].salesReturns += Number(item?.total ?? 0);
    });

    (purchaseItemsData as any[] | undefined)?.forEach((item) => {
      const invoiceDate = relationDate(item, "invoice", "invoice_date");
      if (!invoiceDate) return;
      const key = invoiceDate.substring(0, 7);
      if (monthlyData[key])
        monthlyData[key].purchases += Number(
          item?.net_total ?? item?.total ?? 0,
        );
    });

    (purchaseReturnItemsData as any[] | undefined)?.forEach((item) => {
      const returnDate = relationDate(item, "return", "return_date");
      if (!returnDate) return;
      const key = returnDate.substring(0, 7);
      if (monthlyData[key])
        monthlyData[key].purchaseReturns += Number(item?.total ?? 0);
    });

    (cogsData as any[] | undefined)?.forEach((movement) => {
      const date = movement?.movement_date;
      if (!date) return;
      const key = date.substring(0, 7);
      if (!monthlyData[key]) return;
      const cost = Number(movement?.total_cost ?? 0);
      if (movement?.movement_type === "sale") monthlyData[key].cogs += cost;
      if (movement?.movement_type === "sale_return")
        monthlyData[key].cogs -= cost;
    });

    expensesData?.forEach((expense) => {
      const key = expense.expense_date.substring(0, 7);
      if (monthlyData[key]) monthlyData[key].expenses += Number(expense.amount);
    });

    Object.values(monthlyData).forEach((monthRow) => {
      const monthlyNetSales = monthRow.sales - monthRow.salesReturns;
      const monthlyNetPurchases = monthRow.purchases - monthRow.purchaseReturns;
      monthRow.sales = monthlyNetSales;
      monthRow.purchases = monthlyNetPurchases;
      monthRow.grossProfit = monthlyNetSales - monthRow.cogs;
      monthRow.netProfit = monthRow.grossProfit - monthRow.expenses;
    });

    return Object.values(monthlyData);
  }, [
    salesItemsData,
    salesReturnItemsData,
    purchaseItemsData,
    purchaseReturnItemsData,
    cogsData,
    expensesData,
    dateFrom,
    dateTo,
  ]);

  // --- Top products pie ---
  const topProductsList = useMemo(() => {
    const productMap: Record<string, { name: string; total: number }> = {};

    (salesItemsData as any[] | undefined)?.forEach((item) => {
      const name = productName(item);
      if (!productMap[name]) productMap[name] = { name, total: 0 };
      productMap[name].total += Number(item?.net_total ?? item?.total ?? 0);
    });

    (salesReturnItemsData as any[] | undefined)?.forEach((item) => {
      const name = productName(item);
      if (!productMap[name]) productMap[name] = { name, total: 0 };
      productMap[name].total -= Number(item?.total ?? 0);
    });

    return Object.values(productMap)
      .filter((product) => product.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [salesItemsData, salesReturnItemsData]);

  const fmt = (n: number) =>
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const fmtSigned = (n: number) => `${n > 0 ? "+" : ""}${fmt(n)}`;
  const fmtPct = (n: number) => Math.abs(n).toFixed(1) + "%";
  const fmtShortDateTime = (d: Date) => format(d, "yyyy-MM-dd HH:mm");

  const methodologyLines = [
    "صافي الربح التشغيلي = صافي المبيعات - تكلفة البضاعة المباعة - المصروفات التشغيلية.",
    "صافي الربح المحاسبي = الربح التشغيلي ± تسويات المخزون ± القيود غير التشغيلية.",
    "يتم استخدام جسر المطابقة لتفسير الفروقات بين النتيجة التشغيلية ونتيجة قائمة الدخل.",
  ];

  const reconciliationRows: Array<{
    label: string;
    value: number;
    tone: "neutral" | "positive" | "negative" | "primary";
    rowClass: string;
  }> = [
    {
      label: "صافي الربح التشغيلي (تقرير الأداء)",
      value: netProfit,
      tone: "neutral",
      rowClass: "",
    },
    {
      label: "± صافي أثر تسويات المخزون (4201 - 5201)",
      value: inventoryAdjustmentsNet,
      tone: inventoryAdjustmentsNet >= 0 ? "positive" : "negative",
      rowClass: "bg-muted/20",
    },
    {
      label: "± قيود دفترية أخرى غير تشغيلية",
      value: otherAccountingAdjustments,
      tone: otherAccountingAdjustments >= 0 ? "positive" : "negative",
      rowClass: "",
    },
    {
      label: "= صافي الربح المحاسبي (قائمة الدخل)",
      value: accountingNetProfit,
      tone: "primary",
      rowClass: "bg-primary/5",
    },
  ];

  const isLoading =
    loadingSales ||
    loadingPurchases ||
    loadingExpenses ||
    loadingPrevExpenses ||
    loadingSalesItems ||
    loadingPrevSalesItems ||
    loadingSalesReturnItems ||
    loadingPrevSalesReturnItems ||
    loadingPurchaseItems ||
    loadingPrevPurchaseItems ||
    loadingPurchaseReturnItems ||
    loadingPrevPurchaseReturnItems ||
    loadingCogs ||
    loadingPrevCogs ||
    loadingSalesReturnsHeaders ||
    loadingPurchaseReturnsHeaders ||
    loadingAccountingBridge;

  // --- Trend Icon ---
  const TrendBadge = ({
    value,
    inverted = false,
  }: {
    value: number;
    inverted?: boolean;
  }) => {
    const isPositive = inverted ? value < 0 : value >= 0;
    if (value === 0)
      return (
        <span className="text-[11px] text-muted-foreground flex items-center gap-0.5">
          <Minus className="w-3 h-3" /> 0%
        </span>
      );
    return (
      <span
        className={`text-[11px] flex items-center gap-0.5 ${isPositive ? "text-success" : "text-destructive"}`}
      >
        {value > 0 ? (
          <TrendingUp className="w-3 h-3" />
        ) : (
          <TrendingDown className="w-3 h-3" />
        )}
        {fmtPct(value)}
      </span>
    );
  };

  // --- Export ---
  const getExportData = () => {
    const headers = [
      "الشهر",
      "صافي المبيعات",
      "صافي المشتريات",
      "تكلفة البضاعة المباعة (COGS)",
      "المصروفات التشغيلية",
      "مجمل الربح",
      "صافي الربح",
      "هامش صافي الربح (%)",
    ];
    const rows = chartData.map((m) => {
      const margin = m.sales > 0 ? (m.netProfit / m.sales) * 100 : 0;
      return [
        m.month,
        m.sales,
        m.purchases,
        m.cogs,
        m.expenses,
        m.grossProfit,
        m.netProfit,
        Number(margin.toFixed(2)),
      ];
    });
    return { headers, rows };
  };

  const handleExcelExport = async () => {
    const { headers, rows } = getExportData();
    const exportFilename = `لوحة-الأداء-المالي-${dateFrom}-الى-${dateTo}`;

    await exportToExcel({
      filename: exportFilename,
      sheetName: "الأداء الشهري",
      title: "لوحة الأداء المالي (تشغيلي + جسر مطابقة محاسبي)",
      metaRows: [
        ["الفترة", `${dateFrom} إلى ${dateTo}`],
        ["تاريخ الاستخراج", fmtShortDateTime(new Date())],
        ["المنهجية", "تشغيلي + مطابقة محاسبية"],
      ],
      headers,
      rows,
      extraSheets: [
        {
          sheetName: "الملخص التشغيلي",
          headers: ["المؤشر", "القيمة", "ملاحظة"],
          rows: [
            ["صافي المبيعات", netSales, "بعد خصم مرتجعات المبيعات"],
            [
              "تكلفة البضاعة المباعة (COGS)",
              cogs,
              "من حركات المخزون (sale/sale_return)",
            ],
            ["المصروفات التشغيلية", totalExpenses, "مصروفات الفترة المعتمدة"],
            ["مجمل الربح", grossProfit, "صافي المبيعات - COGS"],
            [
              "صافي الربح التشغيلي",
              netProfit,
              "مجمل الربح - المصروفات التشغيلية",
            ],
            [
              "هامش صافي الربح (%)",
              Number(netMargin.toFixed(2)),
              "صافي الربح / صافي المبيعات",
            ],
            [
              "صافي الربح المحاسبي",
              accountingNetProfit,
              "من القيود المحاسبية للفترة",
            ],
            [
              "هامش الربح المحاسبي (%)",
              Number(accountingMargin.toFixed(2)),
              "صافي الربح المحاسبي / الإيراد المحاسبي",
            ],
            [
              "فرق الربح (محاسبي - تشغيلي)",
              bridgeDifference,
              "فجوة المطابقة بين الشاشتين",
            ],
          ],
        },
        {
          sheetName: "جسر المطابقة",
          headers: ["البند", "القيمة", "التصنيف"],
          rows: [
            ...reconciliationRows.map((row, index) => [
              row.label,
              row.value,
              index === 0
                ? "أساس تشغيلي"
                : index === reconciliationRows.length - 1
                  ? "نتيجة محاسبية"
                  : "تسوية",
            ]),
            ["هامش تشغيلي (%)", Number(netMargin.toFixed(2)), "مؤشر تشغيلي"],
            [
              "هامش محاسبي (%)",
              Number(accountingMargin.toFixed(2)),
              "مؤشر محاسبي",
            ],
            ["الإيراد المحاسبي للفترة", accountingRevenue, "مرجع قائمة الدخل"],
            ["المصروف المحاسبي للفترة", accountingExpenses, "مرجع قائمة الدخل"],
          ],
        },
        {
          sheetName: "التفسير المالي",
          headers: ["العنصر", "الوصف"],
          rows: [
            ["التفسير المالي المعتمد", "العرض الرئيسي في شاشة الأداء المالي"],
            ...methodologyLines.map((line, i) => [`قاعدة ${i + 1}`, line]),
          ],
        },
      ],
    });
  };

  const handlePdfExport = async () => {
    const { headers, rows } = getExportData();
    const fmtN = (n: number) =>
      n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const fmtPctN = (n: number) => `${n.toFixed(1)}%`;
    const exportFilename = `لوحة-الأداء-المالي-${dateFrom}-الى-${dateTo}`;

    await exportReportPdf({
      title: `لوحة الأداء المالي (${dateFrom} إلى ${dateTo})`,
      settings: settings || null,
      headers,
      rows: rows.map((r) => [
        r[0],
        ...r.slice(1, -1).map((v) => fmtN(Number(v))),
        fmtPctN(Number(r[r.length - 1])),
      ]),
      summaryCards: [
        { label: "صافي المبيعات", value: fmtN(netSales) },
        { label: "تكلفة البضاعة المباعة (COGS)", value: fmtN(cogs) },
        { label: "المصروفات التشغيلية", value: fmtN(totalExpenses) },
        { label: "مجمل الربح", value: fmtN(grossProfit) },
        { label: "صافي الربح التشغيلي", value: fmtN(netProfit) },
        { label: "صافي الربح المحاسبي", value: fmtN(accountingNetProfit) },
        { label: "هامش صافي الربح", value: netMargin.toFixed(1) + "%" },
      ],
      methodologyTitle: "التفسير المالي المعتمد",
      methodologyLines,
      reconciliationTitle: "جسر المطابقة بين الربح التشغيلي والمحاسبي",
      reconciliationRows: [
        ...reconciliationRows.map((row) => ({
          label: row.label,
          value:
            row.tone === "neutral" || row.tone === "primary"
              ? fmtN(row.value)
              : fmtSigned(row.value),
          tone: row.tone,
        })),
        {
          label: "هامش تشغيلي",
          value: fmtPctN(netMargin),
          tone: "neutral",
        },
        {
          label: "هامش محاسبي",
          value: fmtPctN(accountingMargin),
          tone: "neutral",
        },
        {
          label: "فرق الربح (محاسبي - تشغيلي)",
          value: fmtSigned(bridgeDifference),
          tone: bridgeDifference >= 0 ? "positive" : "negative",
        },
      ],
      tableTitle: "الأداء الشهري (صافي القيم بعد المرتجعات)",
      filename: exportFilename,
      orientation: "landscape",
    });
  };

  // --- KPI cards config ---
  const kpiCards = [
    {
      label: "صافي المبيعات",
      value: fmt(netSales),
      growth: calcGrowth(netSales, prevNetSales),
      icon: DollarSign,
      color: "text-success",
      bgColor: "bg-success/10",
      count: salesData?.length ?? 0,
      countLabel: "فاتورة",
    },
    {
      label: "تكلفة البضاعة المباعة (COGS)",
      value: fmt(cogs),
      growth: calcGrowth(cogs, prevCogs),
      inverted: true,
      icon: ShoppingCart,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      label: "المصروفات التشغيلية",
      value: fmt(totalExpenses),
      growth: calcGrowth(totalExpenses, prevTotalExpenses),
      inverted: true,
      icon: Receipt,
      color: "text-destructive",
      bgColor: "bg-destructive/10",
    },
    {
      label: "مجمل الربح",
      value: fmt(grossProfit),
      growth: calcGrowth(grossProfit, prevGrossProfit),
      icon: BarChart3,
      color: grossProfit >= 0 ? "text-success" : "text-destructive",
      bgColor: grossProfit >= 0 ? "bg-success/10" : "bg-destructive/10",
      subtitle: `هامش: ${grossMargin.toFixed(1)}%`,
    },
    {
      label: "صافي الربح",
      value: fmt(netProfit),
      growth: calcGrowth(netProfit, prevNetProfit),
      icon: DollarSign,
      color: netProfit >= 0 ? "text-success" : "text-destructive",
      bgColor: netProfit >= 0 ? "bg-success/10" : "bg-destructive/10",
    },
    {
      label: "هامش صافي الربح",
      value: netMargin.toFixed(1) + "%",
      icon: Percent,
      color: netMargin >= 0 ? "text-success" : "text-destructive",
      bgColor: netMargin >= 0 ? "bg-success/10" : "bg-destructive/10",
      noGrowth: true,
    },
  ];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <Skeleton className="h-[300px]" />
          <Skeleton className="h-[300px]" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={quickRange} onValueChange={applyQuickRange}>
          <SelectTrigger className="w-40 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3">آخر 3 أشهر</SelectItem>
            <SelectItem value="6">آخر 6 أشهر</SelectItem>
            <SelectItem value="12">آخر 12 شهر</SelectItem>
            <SelectItem value="custom">مخصص</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">من</span>
          <DatePickerInput
            value={dateFrom}
            onChange={handleDateFromChange}
            className="w-40 h-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">إلى</span>
          <DatePickerInput
            value={dateTo}
            onChange={handleDateToChange}
            className="w-40 h-9"
          />
        </div>
        {dateRangeInvalid && (
          <p className="text-xs text-destructive font-medium">
            تاريخ النهاية يجب أن يكون بعد تاريخ البداية
          </p>
        )}
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleExcelExport}>
          <FileSpreadsheet className="w-4 h-4 ml-2" />
          Excel
        </Button>
        <Button variant="outline" size="sm" onClick={handlePdfExport}>
          <FileText className="w-4 h-4 ml-2" />
          PDF
        </Button>
      </div>

      <Card className="border-primary/25 shadow-none bg-gradient-to-r from-primary/5 via-muted/20 to-success/5">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
              <Info className="w-4 h-4 text-primary" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">التفسير المالي المعتمد</p>
                <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  العرض الرئيسي
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                هذه الشاشة تعرض الأداء التشغيلي أولًا ثم تربطه مباشرة بنتيجة
                قائمة الدخل المحاسبية، حتى يكون الفرق واضحًا ومفهومًا للمستخدم
                بدون لبس.
              </p>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2 text-xs">
            <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-2">
              <p className="text-muted-foreground">صافي الربح التشغيلي</p>
              <p className="font-semibold">
                صافي المبيعات - تكلفة المبيعات - المصروفات
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-2">
              <p className="text-muted-foreground">صافي الربح المحاسبي</p>
              <p className="font-semibold">
                الربح التشغيلي ± تسويات المخزون ± القيود غير التشغيلية
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4">
        {kpiCards.map((kpi) => (
          <Card key={kpi.label} className="border-border/60 shadow-none">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div
                  className={`w-10 h-10 rounded-xl ${kpi.bgColor} flex items-center justify-center`}
                >
                  <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
                </div>
                <p className="text-sm font-medium text-muted-foreground">
                  {kpi.label}
                </p>
              </div>
              <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
              {"subtitle" in kpi && kpi.subtitle && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {kpi.subtitle}
                </p>
              )}
              <div className="flex items-center justify-between mt-2">
                {!kpi.noGrowth ? (
                  <TrendBadge value={kpi.growth!} inverted={kpi.inverted} />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    من إجمالي المبيعات
                  </span>
                )}
                {kpi.count !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    {kpi.count} {kpi.countLabel}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/60 shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            جسر المطابقة بين الربح التشغيلي والمحاسبي
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            يوضح هذا القسم سبب اختلاف النتيجة التشغيلية عن نتيجة قائمة الدخل
            بشكل خطوة بخطوة.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl border border-border/50 overflow-hidden">
            {reconciliationRows.map((row) => (
              <div
                key={row.label}
                className={`flex items-center justify-between gap-4 px-4 py-3 border-b last:border-b-0 border-border/40 ${row.rowClass}`}
              >
                <p className="text-sm text-muted-foreground">{row.label}</p>
                <p
                  className={`text-sm font-bold whitespace-nowrap ${
                    row.tone === "primary"
                      ? "text-primary"
                      : row.tone === "positive"
                        ? "text-success"
                        : row.tone === "negative"
                          ? "text-destructive"
                          : "text-foreground"
                  }`}
                >
                  {row.tone === "neutral" || row.tone === "primary"
                    ? fmt(row.value)
                    : fmtSigned(row.value)}
                </p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg bg-muted/30 border border-border/50 px-3 py-2">
              <p className="text-muted-foreground mb-1">هامش تشغيلي</p>
              <p className="font-bold">{netMargin.toFixed(1)}%</p>
            </div>
            <div className="rounded-lg bg-muted/30 border border-border/50 px-3 py-2">
              <p className="text-muted-foreground mb-1">هامش محاسبي</p>
              <p className="font-bold">{accountingMargin.toFixed(1)}%</p>
            </div>
            <div className="rounded-lg bg-muted/30 border border-border/50 px-3 py-2">
              <p className="text-muted-foreground mb-1">
                فرق الربح (محاسبي - تشغيلي)
              </p>
              <p
                className={`font-bold ${bridgeDifference >= 0 ? "text-success" : "text-destructive"}`}
              >
                {fmtSigned(bridgeDifference)}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
            الإيراد المحاسبي للفترة:{" "}
            <span className="font-semibold text-foreground">
              {fmt(accountingRevenue)}
            </span>{" "}
            | المصروف المحاسبي للفترة:{" "}
            <span className="font-semibold text-foreground">
              {fmt(accountingExpenses)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Charts */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Sales vs Purchases Bar */}
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              المبيعات مقابل المشتريات
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(220, 13%, 91%)"
                />
                <XAxis
                  dataKey="month"
                  fontSize={10}
                  tick={{ fill: "hsl(220, 8%, 46%)" }}
                />
                <YAxis fontSize={10} tick={{ fill: "hsl(220, 8%, 46%)" }} />
                <Tooltip
                  formatter={(v: number) => fmt(v)}
                  contentStyle={{ direction: "rtl", fontSize: 12 }}
                />
                <Legend />
                <Bar
                  dataKey="sales"
                  name="المبيعات"
                  fill="hsl(152, 60%, 42%)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="purchases"
                  name="المشتريات"
                  fill="hsl(24, 95%, 53%)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Profit & Expense Trend Line */}
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-success" />
              اتجاه الربح والمصروفات
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(220, 13%, 91%)"
                />
                <XAxis
                  dataKey="month"
                  fontSize={10}
                  tick={{ fill: "hsl(220, 8%, 46%)" }}
                />
                <YAxis fontSize={10} tick={{ fill: "hsl(220, 8%, 46%)" }} />
                <Tooltip
                  formatter={(v: number) => fmt(v)}
                  contentStyle={{ direction: "rtl", fontSize: 12 }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="grossProfit"
                  name="مجمل الربح"
                  stroke="hsl(152, 60%, 42%)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="netProfit"
                  name="صافي الربح"
                  stroke="hsl(217, 80%, 50%)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="expenses"
                  name="المصروفات"
                  stroke="hsl(0, 72%, 51%)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  strokeDasharray="5 5"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top Products Pie */}
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Package className="w-4 h-4 text-primary" />
              أكثر المنتجات مبيعاً
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topProductsList.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={topProductsList}
                    dataKey="total"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={85}
                    label={({ name, percent }) =>
                      `${name} (${(percent * 100).toFixed(0)}%)`
                    }
                    labelLine={false}
                    fontSize={10}
                  >
                    {topProductsList.map((_, i) => (
                      <Cell
                        key={i}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground text-sm py-20">
                لا توجد بيانات
              </p>
            )}
          </CardContent>
        </Card>

        {/* Customer Indicators */}
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-cat-accounting" />
              مؤشرات العملاء
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-3">
            {[
              {
                label: "إجمالي العملاء النشطين",
                value: String(customersData?.length ?? 0),
                icon: Users,
                color: "text-cat-accounting",
              },
              {
                label: "عملاء لديهم أرصدة مدينة",
                value: String(
                  customersData?.filter((c) => Number(c.balance) > 0).length ??
                    0,
                ),
                icon: Users,
                color: "text-destructive",
              },
              {
                label: "إجمالي أرصدة العملاء",
                value: fmt(
                  customersData?.reduce((s, c) => s + Number(c.balance), 0) ??
                    0,
                ),
                icon: DollarSign,
                color: "text-primary",
              },
              {
                label: "متوسط قيمة الفاتورة",
                value: fmt(avgInvoice),
                icon: Receipt,
                color: "text-success",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <item.icon className={`w-4 h-4 ${item.color}`} />
                  <span className="text-sm text-muted-foreground">
                    {item.label}
                  </span>
                </div>
                <span className="text-base font-bold">{item.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Summary Table: Sales vs Purchases side by side */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Sales Summary */}
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-success" />
              ملخص المبيعات
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-border/40">
                  <td className="px-5 py-3 text-muted-foreground">
                    إجمالي المبيعات
                  </td>
                  <td className="px-5 py-3 text-left font-semibold">
                    {fmt(totalSales)}
                  </td>
                  <td className="px-5 py-3 text-left text-xs text-muted-foreground">
                    {salesData?.length ?? 0} فاتورة
                  </td>
                </tr>
                <tr className="border-b border-border/40 bg-muted/30">
                  <td className="px-5 py-3 text-muted-foreground flex items-center gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5 text-destructive" />
                    مرتجعات المبيعات
                  </td>
                  <td className="px-5 py-3 text-left font-semibold text-destructive">
                    ({fmt(totalSalesReturns)})
                  </td>
                  <td className="px-5 py-3 text-left text-xs text-muted-foreground">
                    {salesReturnsData?.length ?? 0} مرتجع
                  </td>
                </tr>
                <tr className="bg-success/5">
                  <td className="px-5 py-3 font-bold">صافي المبيعات</td>
                  <td className="px-5 py-3 text-left font-bold text-success text-base">
                    {fmt(netSales)}
                  </td>
                  <td className="px-5 py-3"></td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Purchases Summary */}
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-primary" />
              ملخص المشتريات
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-border/40">
                  <td className="px-5 py-3 text-muted-foreground">
                    إجمالي المشتريات
                  </td>
                  <td className="px-5 py-3 text-left font-semibold">
                    {fmt(totalPurchases)}
                  </td>
                  <td className="px-5 py-3 text-left text-xs text-muted-foreground">
                    {purchasesData?.length ?? 0} فاتورة
                  </td>
                </tr>
                <tr className="border-b border-border/40 bg-muted/30">
                  <td className="px-5 py-3 text-muted-foreground flex items-center gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5 text-success" />
                    مرتجعات المشتريات
                  </td>
                  <td className="px-5 py-3 text-left font-semibold text-success">
                    ({fmt(totalPurchaseReturns)})
                  </td>
                  <td className="px-5 py-3 text-left text-xs text-muted-foreground">
                    {purchaseReturnsData?.length ?? 0} مرتجع
                  </td>
                </tr>
                <tr className="bg-primary/5">
                  <td className="px-5 py-3 font-bold">صافي المشتريات</td>
                  <td className="px-5 py-3 text-left font-bold text-primary text-base">
                    {fmt(netPurchases)}
                  </td>
                  <td className="px-5 py-3"></td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
