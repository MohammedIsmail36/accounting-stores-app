import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDisplayNumber } from "@/lib/posted-number-utils";
import {
  computeLiquidity,
  MONTH_NAMES,
  type ExpenseByType,
  type MonthlyData,
  type MonthlyExpense,
  type RecentActivity,
} from "@/lib/dashboard-metrics";

interface InsightsSettings {
  sales_invoice_prefix?: string | null;
  purchase_invoice_prefix?: string | null;
}

/**
 * Charts (monthly sales/purchases/expenses), liquidity, expense mix
 * and the recent-activity feed.
 */
export function useDashboardInsights(settings: InsightsSettings | null | undefined) {
  const [loadingCharts, setLoadingCharts] = useState(true);
  const [loadingRight, setLoadingRight] = useState(true);
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [monthlyExpenses, setMonthlyExpenses] = useState<MonthlyExpense[]>([]);
  const [liquidity, setLiquidity] = useState({ total: 0, cash: 0, bank: 0 });
  const [expensesByType, setExpensesByType] = useState<ExpenseByType[]>([]);
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);

  useEffect(() => {
    const fetchCharts = async () => {
      const y = new Date().getFullYear();
      const [sR, pR, eR] = await Promise.all([
        supabase
          .from("sales_invoices")
          .select("invoice_date, total")
          .eq("status", "posted")
          .gte("invoice_date", `${y}-01-01`)
          .lte("invoice_date", `${y}-12-31`),
        supabase
          .from("purchase_invoices")
          .select("invoice_date, total")
          .eq("status", "posted")
          .gte("invoice_date", `${y}-01-01`)
          .lte("invoice_date", `${y}-12-31`),
        supabase
          .from("expenses")
          .select("expense_date, amount")
          .eq("status", "posted")
          .gte("expense_date", `${y}-01-01`)
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
      // Aggregate server-side via RPC to avoid oversized URLs / 502 responses
      const { data, error } = await (supabase.rpc as any)("get_account_balances", {
        p_only_with_activity: false,
      });
      if (error) {
        console.error("fetchLiquidity failed", error);
        setLiquidity({ total: 0, cash: 0, bank: 0 });
        return;
      }
      setLiquidity(computeLiquidity((data?.rows as any[]) || []));
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
          .select("id, invoice_number, posted_number, status, total, invoice_date, customer_id")
          .order("created_at", { ascending: false })
          .limit(3),
        supabase
          .from("purchase_invoices")
          .select("id, invoice_number, posted_number, status, total, invoice_date, supplier_id")
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
            title: `فاتورة مبيعات ${formatDisplayNumber(settings?.sales_invoice_prefix || "INV-", inv.posted_number, inv.invoice_number, inv.status)}`,
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
            title: `فاتورة مشتريات ${formatDisplayNumber(settings?.purchase_invoice_prefix || "PUR-", inv.posted_number, inv.invoice_number, inv.status)}`,
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

    fetchCharts().finally(() => setLoadingCharts(false));
    Promise.all([fetchLiquidity(), fetchExpensesByType(), fetchRecentActivities()]).finally(() =>
      setLoadingRight(false),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    loadingCharts,
    loadingRight,
    monthlyData,
    monthlyExpenses,
    liquidity,
    expensesByType,
    recentActivities,
  };
}
