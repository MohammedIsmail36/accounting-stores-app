import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPaged } from "@/lib/paged-fetch";
import {
  computeAgingBuckets,
  computeCustomerConcentration,
  STAGNANT_DAYS_THRESHOLD,
  type AccountBalance,
  type AgingBucket,
  type CustomerConcentration,
  type LowStockItem,
  type StagnantItem,
  type TopCategory,
  type TopProduct,
  type UnpaidInvoice,
} from "@/lib/dashboard-metrics";

/** Table/list datasets of the dashboard (unpaid invoices, stock, balances, aging…). */
export function useDashboardTables() {
  const [loadingTables, setLoadingTables] = useState(true);
  const [unpaidInvoices, setUnpaidInvoices] = useState<UnpaidInvoice[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const [accountBalances, setAccountBalances] = useState<AccountBalance[]>([]);
  const [topCategories, setTopCategories] = useState<TopCategory[]>([]);
  const [stagnantItems, setStagnantItems] = useState<StagnantItem[]>([]);
  const [agingBuckets, setAgingBuckets] = useState<AgingBucket[]>([]);
  const [topCustomers, setTopCustomers] = useState<CustomerConcentration[]>([]);

  useEffect(() => {
    const fetchUnpaidInvoices = async () => {
      const { data } = await (supabase.rpc as any)("get_unpaid_invoices", { p_limit: 10 });
      if (!data) return;
      setUnpaidInvoices(
        (data as any[]).map((inv: any) => ({
          id: inv.id,
          invoice_number: inv.invoice_number,
          posted_number: inv.posted_number ?? null,
          customer_name: inv.customer_name || "عميل نقدي",
          total: Number(inv.total),
          paid_amount: Number(inv.paid_amount),
          remaining: Number(inv.remaining),
        })),
      );
    };

    const fetchTopProducts = async () => {
      const { data } = await (supabase.rpc as any)("get_top_products", { p_limit: 10 });
      if (!data?.length) return;
      setTopProducts(
        (data as any[]).map((p: any) => ({
          product_id: p.product_id,
          name: p.product_name || "منتج",
          totalQty: Number(p.total_qty),
          totalAmount: Number(p.total_amount),
        })),
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
          .filter((p: any) => Number(p.quantity_on_hand) < Number(p.min_stock_level) && Number(p.min_stock_level) > 0)
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
      // Aggregate server-side via RPC (no huge row transfers → no 502 / timeouts)
      const { data, error } = await (supabase.rpc as any)("get_account_balances", {
        p_only_with_activity: true,
      });
      if (error) {
        console.error("fetchBalances failed", error);
        setAccountBalances([]);
        return;
      }
      const rows: any[] = (data?.rows as any[]) || [];
      setAccountBalances(
        rows.map((r: any) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          account_type: r.account_type,
          debit: Number(r.debit) || 0,
          credit: Number(r.credit) || 0,
          balance: Number(r.balance) || 0,
        })),
      );
    };

    const fetchTopCategories = async () => {
      const items = await fetchAllPaged<any>(() =>
        (supabase.from("sales_invoice_items") as any)
          .select("product_id, quantity, total, net_total, invoice_id, sales_invoices!inner(status)", {
            count: "exact",
          })
          .eq("sales_invoices.status", "posted"),
      );
      if (!items.length) {
        setTopCategories([]);
        return;
      }
      const posted = new Set(items.map((i: any) => i.invoice_id));
      const pIds = [...new Set(items.filter((i: any) => i.product_id).map((i: any) => i.product_id))] as string[];
      if (!pIds.length) {
        setTopCategories([]);
        return;
      }
      const prods = await fetchAllPaged<any>(() =>
        supabase.from("products").select("id, category_id, purchase_price", { count: "exact" }),
      );
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
          .sort((a, b) => b.totalProfit - a.totalProfit)
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
      const pIds: string[] = prods.map((p: any) => p.id);
      // Batch in chunks of 50 to avoid URL length overflow
      const CHUNK = 50;
      const allMoves: any[] = [];
      for (let i = 0; i < pIds.length; i += CHUNK) {
        const { data } = await supabase
          .from("inventory_movements")
          .select("product_id, movement_date")
          .in("product_id", pIds.slice(i, i + CHUNK))
          .order("movement_date", { ascending: false });
        if (data) allMoves.push(...data);
      }
      const lm = new Map<string, string>();
      allMoves.forEach((m: any) => {
        if (!lm.has(m.product_id)) lm.set(m.product_id, m.movement_date);
      });
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - STAGNANT_DAYS_THRESHOLD);
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

    const fetchAgingBuckets = async () => {
      const { data } = await supabase
        .from("sales_invoices")
        .select("invoice_date, total, paid_amount")
        .eq("status", "posted");
      if (!data?.length) return;
      setAgingBuckets(computeAgingBuckets(data));
    };

    const fetchTopCustomers = async () => {
      const { data } = await supabase.from("sales_invoices").select("customer_id, total").eq("status", "posted");
      if (!data?.length) return;
      const preview = computeCustomerConcentration(data, (id) => id);
      const customerIds = preview.map((r) => r.name).filter((id) => id !== "__cash__");
      const { data: customers } = customerIds.length
        ? await supabase.from("customers").select("id, name").in("id", customerIds)
        : { data: [] };
      const nameMap = new Map((customers || []).map((c) => [c.id, c.name]));
      setTopCustomers(
        computeCustomerConcentration(data, (id) => (id === "__cash__" ? "عميل نقدي" : nameMap.get(id) || "عميل")),
      );
    };

    Promise.all([
      fetchUnpaidInvoices(),
      fetchTopProducts(),
      fetchLowStock(),
      fetchBalances(),
      fetchTopCategories(),
      fetchStagnantStock(),
      fetchAgingBuckets(),
      fetchTopCustomers(),
    ]).finally(() => setLoadingTables(false));
  }, []);

  return {
    loadingTables,
    unpaidInvoices,
    topProducts,
    lowStockItems,
    accountBalances,
    topCategories,
    stagnantItems,
    agingBuckets,
    topCustomers,
  };
}
