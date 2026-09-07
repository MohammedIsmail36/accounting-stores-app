import { round2 } from "@/lib/utils";

/**
 * ─────────────────────────────────────────────────────────────
 *  inventory-metrics.ts — المصدر الوحيد لحسابات المخزون
 * ─────────────────────────────────────────────────────────────
 *  كل شاشة/تقرير مخزون يجب أن يستهلك هذه الدوال فقط.
 *  لا حسابات محلية للـ WAC أو قيمة المخزون أو معدل الدوران داخل المكوّنات.
 */

export type MovementType =
  | "opening_balance"
  | "purchase"
  | "purchase_return"
  | "sale"
  | "sale_return"
  | "adjustment";

/** حركة مخزون مبسّطة (ما نحتاجه فقط من الجدول) */
export interface InventoryMovementRow {
  product_id: string;
  movement_type: MovementType | string;
  quantity: number | string | null;
  unit_cost?: number | string | null;
  total_cost?: number | string | null;
  movement_date?: string | null;
}

/** حركات تزيد الكمية (الإشارة موجبة) */
export const INBOUND_TYPES: MovementType[] = [
  "opening_balance",
  "purchase",
  "sale_return",
];

/** حركات تنقص الكمية (الإشارة سالبة) */
export const OUTBOUND_TYPES: MovementType[] = ["sale", "purchase_return"];

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * إشارة الحركة على الكمية.
 * `adjustment` تُخزَّن بكمية موقّعة أصلاً (+/-) فتُعاد كما هي.
 */
export function movementSign(type: string): 1 | -1 {
  if (OUTBOUND_TYPES.includes(type as MovementType)) return -1;
  return 1;
}

/** الأثر الموقّع للحركة على الكمية */
export function signedQuantity(m: InventoryMovementRow): number {
  const q = num(m.quantity);
  if (m.movement_type === "adjustment") return q; // موقّعة مسبقاً
  return movementSign(String(m.movement_type)) * Math.abs(q);
}

/** الأثر الموقّع للحركة على القيمة الدفترية للمخزون */
export function signedValue(m: InventoryMovementRow): number {
  const cost =
    m.total_cost != null && m.total_cost !== ""
      ? num(m.total_cost)
      : Math.abs(num(m.quantity)) * num(m.unit_cost);
  if (m.movement_type === "adjustment") {
    return num(m.quantity) < 0 ? -Math.abs(cost) : Math.abs(cost);
  }
  return movementSign(String(m.movement_type)) * Math.abs(cost);
}

/** ملخّص حركات منتج واحد */
export interface ProductMovementSummary {
  /** الكمية الصافية من الحركات */
  quantity: number;
  /** القيمة الدفترية الصافية من الحركات */
  value: number;
  /** كمية المشتريات + الرصيد الافتتاحي (أساس WAC) */
  purchasedQty: number;
  /** تكلفة المشتريات + الرصيد الافتتاحي (أساس WAC) */
  purchasedCost: number;
  /** كمية المبيعات (موجبة) */
  soldQty: number;
  /** كمية مرتجعات البيع (موجبة) */
  salesReturnQty: number;
  /** كمية مرتجعات الشراء (موجبة) */
  purchaseReturnQty: number;
  /** صافي كمية التسويات (موقّعة) */
  adjustmentQty: number;
  /** آخر تاريخ بيع */
  lastSaleDate: string | null;
  /** آخر تاريخ حركة (أي نوع) */
  lastMovementDate: string | null;
}

export function emptySummary(): ProductMovementSummary {
  return {
    quantity: 0,
    value: 0,
    purchasedQty: 0,
    purchasedCost: 0,
    soldQty: 0,
    salesReturnQty: 0,
    purchaseReturnQty: 0,
    adjustmentQty: 0,
    lastSaleDate: null,
    lastMovementDate: null,
  };
}

const maxDate = (a: string | null, b?: string | null): string | null => {
  if (!b) return a;
  if (!a) return b;
  return b > a ? b : a;
};

/** تجميع الحركات لكل منتج — مصدر وحيد لكل التقارير */
export function summarizeMovements(
  movements: InventoryMovementRow[],
): Map<string, ProductMovementSummary> {
  const map = new Map<string, ProductMovementSummary>();

  for (const m of movements) {
    if (!m?.product_id) continue;
    const cur = map.get(m.product_id) ?? emptySummary();
    const type = String(m.movement_type);
    const absQty = Math.abs(num(m.quantity));

    cur.quantity += signedQuantity(m);
    cur.value += signedValue(m);
    cur.lastMovementDate = maxDate(cur.lastMovementDate, m.movement_date);

    if (type === "purchase" || type === "opening_balance") {
      cur.purchasedQty += absQty;
      cur.purchasedCost += Math.abs(signedValue(m));
    } else if (type === "sale") {
      cur.soldQty += absQty;
      cur.lastSaleDate = maxDate(cur.lastSaleDate, m.movement_date);
    } else if (type === "sale_return") {
      cur.salesReturnQty += absQty;
    } else if (type === "purchase_return") {
      cur.purchaseReturnQty += absQty;
    } else if (type === "adjustment") {
      cur.adjustmentQty += num(m.quantity);
    }

    map.set(m.product_id, cur);
  }

  // تدوير القيم النهائية مرة واحدة
  for (const [, s] of map) {
    s.quantity = round2(s.quantity);
    s.value = round2(s.value);
    s.purchasedCost = round2(s.purchasedCost);
  }

  return map;
}

/**
 * متوسط التكلفة المرجّح (WAC).
 * يعتمد على المشتريات والرصيد الافتتاحي فقط؛ وعند غيابهما يرجع لسعر الشراء المُسجّل.
 */
export function weightedAverageCost(
  summary: ProductMovementSummary | undefined,
  fallbackPurchasePrice = 0,
): number {
  if (summary && summary.purchasedQty > 0) {
    return round2(summary.purchasedCost / summary.purchasedQty);
  }
  return round2(num(fallbackPurchasePrice));
}

/** قيمة مخزون المنتج = الكمية × WAC */
export function inventoryValue(quantity: number, wac: number): number {
  return round2(num(quantity) * num(wac));
}

/** صافي الكمية المبيعة (مبيعات − مرتجعات بيع) */
export function netSoldQuantity(summary: ProductMovementSummary): number {
  return round2(summary.soldQty - summary.salesReturnQty);
}

/**
 * معدل دوران المخزون = صافي كمية المبيعات ÷ متوسط الكمية.
 * يُعاد `null` عندما لا يوجد أساس يمكن القسمة عليه (بدلاً من صفر مضلّل).
 */
export function turnoverRate(
  netSold: number,
  averageQuantity: number,
): number | null {
  if (averageQuantity <= 0) return null;
  return round2(netSold / averageQuantity);
}

/** متوسط الكمية بين بداية ونهاية الفترة */
export function averageQuantity(opening: number, closing: number): number {
  return round2((num(opening) + num(closing)) / 2);
}

/**
 * أيام التغطية = الكمية المتاحة ÷ متوسط البيع اليومي.
 * `null` = لا مبيعات في الفترة (تغطية غير محدّدة).
 */
export function daysOfCover(
  quantityOnHand: number,
  netSold: number,
  periodDays: number,
): number | null {
  if (periodDays <= 0 || netSold <= 0) return null;
  const perDay = netSold / periodDays;
  if (perDay <= 0) return null;
  return round2(num(quantityOnHand) / perDay);
}

/** عدد الأيام منذ آخر بيع — `null` إذا لم يُبَع أبداً */
export function daysSinceLastSale(
  lastSaleDate: string | null,
  today: Date = new Date(),
): number | null {
  if (!lastSaleDate) return null;
  const last = new Date(lastSaleDate);
  if (Number.isNaN(last.getTime())) return null;
  const ms = today.getTime() - last.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** عمر المنتج بالأيام منذ إنشائه */
export function productAgeDays(
  createdAt: string | null | undefined,
  today: Date = new Date(),
): number | null {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86_400_000));
}

/** حالة المخزون بالنسبة للحد الأدنى */
export type StockStatus = "out" | "low" | "ok";

export function stockStatus(quantity: number, minLevel: number): StockStatus {
  const q = num(quantity);
  if (q <= 0) return "out";
  if (num(minLevel) > 0 && q <= num(minLevel)) return "low";
  return "ok";
}

/** كمية شراء مقترحة لتغطية `targetDays` بمعدل البيع الحالي */
export function suggestedPurchaseQuantity(opts: {
  quantityOnHand: number;
  netSold: number;
  periodDays: number;
  minStockLevel?: number;
  targetDays?: number;
}): number {
  const { quantityOnHand, netSold, periodDays } = opts;
  const targetDays = opts.targetDays ?? 30;
  const minLevel = num(opts.minStockLevel);

  const perDay = periodDays > 0 && netSold > 0 ? netSold / periodDays : 0;
  const target = Math.max(perDay * targetDays, minLevel);
  const need = target - num(quantityOnHand);
  return need > 0 ? Math.ceil(need) : 0;
}

/** إجماليات المخزون على مستوى النظام */
export interface InventoryTotals {
  productCount: number;
  totalQuantity: number;
  totalValue: number;
  outOfStockCount: number;
  lowStockCount: number;
}

export interface ProductStockRow {
  quantity: number;
  wac: number;
  minStockLevel?: number;
}

export function computeInventoryTotals(rows: ProductStockRow[]): InventoryTotals {
  let totalQuantity = 0;
  let totalValue = 0;
  let outOfStockCount = 0;
  let lowStockCount = 0;

  for (const r of rows) {
    totalQuantity += num(r.quantity);
    totalValue += inventoryValue(r.quantity, r.wac);
    const st = stockStatus(r.quantity, num(r.minStockLevel));
    if (st === "out") outOfStockCount += 1;
    else if (st === "low") lowStockCount += 1;
  }

  return {
    productCount: rows.length,
    totalQuantity: round2(totalQuantity),
    totalValue: round2(totalValue),
    outOfStockCount,
    lowStockCount,
  };
}
