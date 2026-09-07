/**
 * Pure calculation helpers + shared types for the Dashboard.
 *
 * All accounting logic used by the dashboard lives here so it can be unit tested
 * independently from data fetching (see `src/hooks/use-dashboard-*.ts`).
 */

export const MONTH_NAMES = [
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

/** Days without movement to consider stock stagnant */
export const STAGNANT_DAYS_THRESHOLD = 30;
/** Number of days for the recent sales table */
export const RECENT_SALES_DAYS = 7;

export interface MonthlyData {
  name: string;
  مبيعات: number;
  مشتريات: number;
}
export interface MonthlyExpense {
  name: string;
  مصروفات: number;
}
export interface AccountBalance {
  id: string;
  code: string;
  name: string;
  account_type: string;
  debit: number;
  credit: number;
  balance: number;
}
export interface UnpaidInvoice {
  id: string;
  invoice_number: number;
  posted_number: number | null;
  customer_name: string;
  total: number;
  paid_amount: number;
  remaining: number;
}
export interface TopProduct {
  product_id: string;
  name: string;
  totalQty: number;
  totalAmount: number;
}
export interface LowStockItem {
  name: string;
  brandName: string | null;
  modelNumber: string | null;
  quantity_on_hand: number;
  min_stock_level: number;
}
export interface ExpenseByType {
  name: string;
  amount: number;
}
export interface RecentActivity {
  id: string;
  title: string;
  subtitle: string;
  amount: number;
  type: "sale" | "purchase" | "expense";
  date: string;
}
export interface TopCategory {
  name: string;
  totalSales: number;
  totalProfit: number;
}
export interface StagnantItem {
  name: string;
  brandName: string | null;
  modelNumber: string | null;
  quantity_on_hand: number;
  lastMovement: string | null;
}
export interface AgingBucket {
  label: string;
  count: number;
  total: number;
}
export interface CustomerConcentration {
  name: string;
  total: number;
  percentage: number;
}

// ─── Row helpers ───────────────────────────────────────────────────────────────

/** Reads a date off an embedded PostgREST relation (object or single-element array). */
export function relationDate(
  row: any,
  relationKey: "invoice" | "return",
  dateKey: "invoice_date" | "return_date",
): string {
  const relation = row?.[relationKey];
  if (Array.isArray(relation)) return relation[0]?.[dateKey] || "";
  return relation?.[dateKey] || "";
}

/** Sum of `net_total` with `total` fallback — the reporting standard for line items. */
export function sumNet(rows: any[]): number {
  return (rows || []).reduce((s, i) => s + Number(i.net_total ?? i.total ?? 0), 0);
}

export function sumTotal(rows: any[]): number {
  return (rows || []).reduce((s, i) => s + Number(i.total ?? 0), 0);
}

/**
 * COGS from inventory movements: sales add cost, sales returns credit it back.
 */
export function computeCOGS(rows: any[]): number {
  return (rows || []).reduce((s, i) => {
    const cost = Number(i.total_cost || 0);
    if (i.movement_type === "sale") return s + cost;
    if (i.movement_type === "sale_return") return s - cost;
    return s;
  }, 0);
}

/**
 * Buckets expense-side GL lines into regular operating expenses and system
 * adjustments (5108 PPV / 5201), then nets the inventory adjustment gain
 * (4201, credit-normal revenue) against the system adjustments so surplus
 * offsets shortage.
 */
export function bucketExpenseLines(
  expenseLines: any[],
  adjustmentGainLines: any[],
): { operating: number; system: number; total: number } {
  let operating = 0;
  let system = 0;
  (expenseLines || []).forEach((l: any) => {
    const code = l.accounts?.code;
    const amt = Number(l.debit || 0) - Number(l.credit || 0);
    if (code === "5108" || code === "5201") system += amt;
    else operating += amt;
  });
  const adjustmentGain = (adjustmentGainLines || []).reduce(
    (s: number, l: any) => s + (Number(l.credit || 0) - Number(l.debit || 0)),
    0,
  );
  system -= adjustmentGain;
  return { operating, system, total: operating + system };
}

/** Sums rows falling inside a given month/year. */
export function sumForMonth(
  rows: any[],
  month: number,
  year: number,
  getDate: (row: any) => string,
  getValue: (row: any) => number,
): number {
  return (rows || [])
    .filter((i) => {
      const d = new Date(getDate(i));
      return d.getMonth() === month && d.getFullYear() === year;
    })
    .reduce((s, i) => s + getValue(i), 0);
}

/**
 * صافي مبيعات شهر معيّن = إجمالي الفواتير المرحّلة − مرتجعات المبيعات المرحّلة.
 * مصدر واحد للحقيقة يستخدمه كل من لوحة التحكم وتقرير المبيعات (هدف المبيعات الشهري).
 */
export function computeMonthNetSales(
  invoiceRows: any[],
  returnRows: any[],
  month: number,
  year: number,
  getInvoiceDate: (row: any) => string,
  getInvoiceValue: (row: any) => number,
  getReturnDate: (row: any) => string,
  getReturnValue: (row: any) => number,
): number {
  const gross = sumForMonth(invoiceRows, month, year, getInvoiceDate, getInvoiceValue);
  const returns = sumForMonth(returnRows, month, year, getReturnDate, getReturnValue);
  return gross - returns;
}

/**
 * Percentage change of the current month vs. the previous month.
 * Returns null when there is no comparable previous-month base.
 */
export function computeMonthlyChange(
  rows: any[],
  getDate: (row: any) => string,
  getValue: (row: any) => number,
  now: Date = new Date(),
): number | null {
  const cm = now.getMonth();
  const cy = now.getFullYear();
  const pm = cm === 0 ? 11 : cm - 1;
  const py = cm === 0 ? cy - 1 : cy;
  const current = sumForMonth(rows, cm, cy, getDate, getValue);
  const previous = sumForMonth(rows, pm, py, getDate, getValue);
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}

/** Splits cash (1101*) and bank (1102*) net balances out of account rows. */
export function computeLiquidity(rows: any[]): { total: number; cash: number; bank: number } {
  let cash = 0;
  let bank = 0;
  (rows || []).forEach((r: any) => {
    const code = String(r.code || "");
    const net = (Number(r.debit) || 0) - (Number(r.credit) || 0);
    if (code.startsWith("1101")) cash += net;
    else if (code.startsWith("1102")) bank += net;
  });
  return { total: cash + bank, cash, bank };
}

/** Receivable aging buckets from posted sales invoices. */
export function computeAgingBuckets(invoices: any[], now: Date = new Date()): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { label: "جاري (0-30)", count: 0, total: 0 },
    { label: "31-60 يوم", count: 0, total: 0 },
    { label: "61-90 يوم", count: 0, total: 0 },
    { label: "أكثر من 90", count: 0, total: 0 },
  ];
  for (const inv of invoices || []) {
    const remaining = Number(inv.total) - Number(inv.paid_amount || 0);
    if (remaining <= 0.01) continue;
    const days = Math.floor((now.getTime() - new Date(inv.invoice_date).getTime()) / 86400000);
    const idx = days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3;
    buckets[idx].count++;
    buckets[idx].total += remaining;
  }
  return buckets;
}

/** Top-N customers by posted sales with their share of total sales. */
export function computeCustomerConcentration(
  invoices: any[],
  nameFor: (customerId: string) => string,
  limit = 5,
): CustomerConcentration[] {
  const byCustomer = new Map<string, number>();
  let grandTotal = 0;
  for (const inv of invoices || []) {
    const cid = inv.customer_id || "__cash__";
    const t = Number(inv.total);
    byCustomer.set(cid, (byCustomer.get(cid) || 0) + t);
    grandTotal += t;
  }
  if (grandTotal <= 0) return [];
  return [...byCustomer.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, total]) => ({
      name: nameFor(id),
      total,
      percentage: Number(((total / grandTotal) * 100).toFixed(1)),
    }));
}

/** Derived P&L figures shown at the top of the dashboard. */
export function computeDerivedTotals(input: {
  totalSales: number;
  totalSalesReturns: number;
  totalPurchases: number;
  totalPurchaseReturns: number;
  totalCOGS: number;
  totalExpenses: number;
}) {
  const netSales = input.totalSales - input.totalSalesReturns;
  const netPurchases = input.totalPurchases - input.totalPurchaseReturns;
  const grossProfit = netSales - input.totalCOGS;
  const netProfit = grossProfit - input.totalExpenses;
  const profitMargin = netSales > 0 ? ((netProfit / netSales) * 100).toFixed(1) : "0";
  return { netSales, netPurchases, grossProfit, netProfit, profitMargin };
}
