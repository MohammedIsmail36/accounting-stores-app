import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  bucketExpenseLines,
  computeCOGS,
  computeMonthlyChange,
  computeMonthNetSales,
  relationDate,
  sumNet,
  sumTotal,
} from "@/lib/dashboard-metrics";

/**
 * Primary + secondary KPI figures for the dashboard.
 * Scope is the current calendar year (see mem://ux/dashboard-period-constraint).
 */
export function useDashboardKpis() {
  const [loadingKPIs, setLoadingKPIs] = useState(true);
  const [loadingSecondary, setLoadingSecondary] = useState(true);

  const [totalSales, setTotalSales] = useState(0);
  const [totalPurchases, setTotalPurchases] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [operatingExpenses, setOperatingExpenses] = useState(0);
  const [systemAdjustments, setSystemAdjustments] = useState(0);
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

  useEffect(() => {
    const fetchKPIs = async () => {
      const now = new Date();
      const cm = now.getMonth();
      const cy = now.getFullYear();
      const todayLocal = `${cy}-${String(cm + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const ys = `${cy}-01-01`;
      const ye = todayLocal;
      const [sItemsR, pItemsR, eR, srItemsR, prItemsR, cogsR, opExpR, adjGainR] = await Promise.all([
        supabase
          .from("sales_invoice_items")
          .select("total, net_total, invoice:sales_invoices!inner(invoice_date, status)")
          .gte("invoice.invoice_date", ys)
          .lte("invoice.invoice_date", ye)
          .eq("invoice.status", "posted"),
        supabase
          .from("purchase_invoice_items")
          .select("total, net_total, invoice:purchase_invoices!inner(invoice_date, status)")
          .gte("invoice.invoice_date", ys)
          .lte("invoice.invoice_date", ye)
          .eq("invoice.status", "posted"),
        supabase
          .from("expenses")
          .select("amount, expense_date")
          .eq("status", "posted")
          .gte("expense_date", ys)
          .lte("expense_date", ye),
        supabase
          .from("sales_return_items")
          .select("total, return:sales_returns!inner(return_date, status)")
          .gte("return.return_date", ys)
          .lte("return.return_date", ye)
          .eq("return.status", "posted"),
        supabase
          .from("purchase_return_items")
          .select("total, return:purchase_returns!inner(return_date, status)")
          .gte("return.return_date", ys)
          .lte("return.return_date", ye)
          .eq("return.status", "posted"),
        supabase
          .from("inventory_movements")
          .select("movement_type, total_cost, movement_date")
          .in("movement_type", ["sale", "sale_return"])
          .gte("movement_date", ys)
          .lte("movement_date", ye),
        // Operating expenses from GL: all expense accounts EXCEPT COGS (5101)
        // This captures PPV (5108), JV entries, and regular expenses uniformly.
        supabase
          .from("journal_entry_lines")
          .select("debit, credit, accounts!inner(code, account_type), journal_entries!inner(entry_date, status)")
          .eq("accounts.account_type", "expense")
          .neq("accounts.code", "5101")
          .in("journal_entries.status", ["posted", "approved"])
          .gte("journal_entries.entry_date", ys)
          .lte("journal_entries.entry_date", ye),
        // Inventory adjustment GAIN (4201, revenue) — netted against system adjustments
        supabase
          .from("journal_entry_lines")
          .select("debit, credit, accounts!inner(code), journal_entries!inner(entry_date, status)")
          .eq("accounts.code", "4201")
          .in("journal_entries.status", ["posted", "approved"])
          .gte("journal_entries.entry_date", ys)
          .lte("journal_entries.entry_date", ye),
      ]);

      const salesItems = sItemsR.data || [];
      const purchaseItems = pItemsR.data || [];
      const expenses = eR.data || [];

      setTotalSales(sumNet(salesItems));
      setTotalPurchases(sumNet(purchaseItems));

      const buckets = bucketExpenseLines(opExpR.data || [], adjGainR.data || []);
      setOperatingExpenses(buckets.operating);
      setSystemAdjustments(buckets.system);
      setTotalExpenses(buckets.total);

      setTotalSalesReturns(sumTotal(srItemsR.data || []));
      setTotalPurchaseReturns(sumTotal(prItemsR.data || []));
      setTotalCOGS(computeCOGS(cogsR.data || []));

      const invoiceDate = (row: any) => relationDate(row, "invoice", "invoice_date");
      const itemValue = (row: any) => Number(row.net_total || row.total || 0);

      const returnDate = (row: any) => relationDate(row, "return", "return_date");
      const returnValue = (row: any) => Number(row.total || 0);
      setCurrentMonthSales(
        computeMonthNetSales(
          salesItems,
          srItemsR.data || [],
          cm,
          cy,
          invoiceDate,
          itemValue,
          returnDate,
          returnValue,
        ),
      );
      setSalesChange(computeMonthlyChange(salesItems, invoiceDate, itemValue, now));
      setPurchasesChange(computeMonthlyChange(purchaseItems, invoiceDate, itemValue, now));
      setExpensesChange(
        computeMonthlyChange(
          expenses,
          (row) => row.expense_date,
          (row) => Number(row.amount || 0),
          now,
        ),
      );
    };

    const fetchSecondaryKPIs = async () => {
      const [cR, sR, pR] = await Promise.all([
        supabase.from("customers").select("balance"),
        supabase.from("suppliers").select("balance"),
        supabase.from("products").select("id, quantity_on_hand, min_stock_level, purchase_price").eq("is_active", true),
      ]);
      const products = pR.data || [];
      setReceivables((cR.data || []).filter((c) => Number(c.balance) > 0).reduce((s, c) => s + Number(c.balance), 0));
      setPayables((sR.data || []).filter((s) => Number(s.balance) > 0).reduce((s2, s) => s2 + Number(s.balance), 0));
      // Inventory Value = رصيد حساب المخزون (1104) في دفتر الأستاذ
      // مصدر واحد للحقيقة يطابق ميزان المراجعة ولا يتأثر بحجم الجداول أو حدود PostgREST.
      let invValue = 0;
      const { data: invLines } = await supabase
        .from("journal_entry_lines")
        .select("debit, credit, accounts!inner(code), journal_entries!inner(status)")
        .eq("accounts.code", "1104")
        .in("journal_entries.status", ["posted", "approved"]);
      (invLines || []).forEach((l: any) => {
        invValue += Number(l.debit || 0) - Number(l.credit || 0);
      });
      setInventoryValue(invValue);

      setLowStockCount(
        products.filter((p) => Number(p.quantity_on_hand) < Number(p.min_stock_level) && Number(p.min_stock_level) > 0)
          .length,
      );
    };

    fetchKPIs().finally(() => setLoadingKPIs(false));
    fetchSecondaryKPIs().finally(() => setLoadingSecondary(false));
  }, []);

  return {
    loadingKPIs,
    loadingSecondary,
    totalSales,
    totalPurchases,
    totalExpenses,
    operatingExpenses,
    systemAdjustments,
    totalSalesReturns,
    totalPurchaseReturns,
    totalCOGS,
    salesChange,
    purchasesChange,
    expensesChange,
    currentMonthSales,
    receivables,
    payables,
    inventoryValue,
    lowStockCount,
  };
}
