/**
 * Margin & Markup calculations
 *
 * Profit Margin = (Sale - Cost) / Sale   → نسبة الربح من سعر البيع
 * Markup        = (Sale - Cost) / Cost   → نسبة الربح على التكلفة
 *
 * These are different metrics. The system standard is **Profit Margin**.
 * Markup is exposed alongside it for pricing context only.
 */

export interface MarginResult {
  /** Sale - Cost */
  profit: number;
  /** Profit / Sale × 100 */
  marginPct: number;
  /** Profit / Cost × 100 */
  markupPct: number;
}

export function calcMargin(sellingPrice: number, purchasePrice: number): MarginResult {
  const profit = sellingPrice - purchasePrice;
  const marginPct = sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0;
  const markupPct = purchasePrice > 0 ? (profit / purchasePrice) * 100 : 0;
  return { profit, marginPct, markupPct };
}
