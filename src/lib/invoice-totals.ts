import { round2 } from "@/lib/utils";

interface LineItem {
  total: number;
  discount: number;
}

interface InvoiceTotalsInput {
  items: LineItem[];
  invoiceDiscount?: number;
  showTax: boolean;
  taxRate: number;
}

interface InvoiceTotalsResult {
  subtotal: number;
  hasLineDiscount: boolean;
  hasInvoiceDiscount: boolean;
  discountMode: "line" | "invoice" | "none";
  afterDiscount: number;
  taxAmount: number;
  grandTotal: number;
}

export function calcInvoiceTotals({
  items,
  invoiceDiscount = 0,
  showTax,
  taxRate,
}: InvoiceTotalsInput): InvoiceTotalsResult {
  const subtotal = round2(items.reduce((s, i) => s + i.total, 0));
  const hasLineDiscount = items.some((i) => i.discount > 0);
  const hasInvoiceDiscount = invoiceDiscount > 0;
  const discountMode: "line" | "invoice" | "none" = hasLineDiscount
    ? "line"
    : hasInvoiceDiscount
      ? "invoice"
      : "none";
  const afterDiscount = round2(subtotal - invoiceDiscount);
  const taxAmount = round2(showTax ? afterDiscount * (taxRate / 100) : 0);
  const grandTotal = round2(afterDiscount + taxAmount);

  return {
    subtotal,
    hasLineDiscount,
    hasInvoiceDiscount,
    discountMode,
    afterDiscount,
    taxAmount,
    grandTotal,
  };
}

/**
 * توزيع أي خصم/تخفيض على مستوى الفاتورة (خصم عام + خصم نقاط الولاء) على السطور
 * بشكل تناسبي، لضمان أن مجموع `net_total` يساوي الصافي بعد الخصم.
 *
 * المعادلة: net_total = total × (1 − reduction / base)
 * حيث base هو مجموع إجماليات السطور (أو قيمة صريحة مثل subtotal المُقرّب).
 * عند reduction = 0 تبقى القيمة مساوية للإجمالي الأصلي.
 * إذا نتج فرق سنتات من تقريب كل سطر منفردًا، يُحمّل الفرق على أكبر سطر
 * حتى يظل مجموع السطور مطابقًا لصافي المستند المحسوب.
 */
export function distributeNetTotals<T extends { total: number }>(
  items: T[],
  reduction: number,
  base?: number,
): (T & { net_total: number })[] {
  if (items.length === 0) return [];

  const total = base ?? items.reduce((s, i) => s + i.total, 0);
  const ratio = total > 0 && reduction > 0 ? reduction / total : 0;
  const rawNetTotals = items.map((item) => item.total * (1 - ratio));
  const roundedNetTotals = rawNetTotals.map((value) => round2(value));
  const targetNetTotal = round2(rawNetTotals.reduce((sum, value) => sum + value, 0));
  const roundedSum = round2(roundedNetTotals.reduce((sum, value) => sum + value, 0));
  const residual = round2(targetNetTotal - roundedSum);

  if (residual !== 0) {
    const adjustmentIndex = rawNetTotals.reduce(
      (largestIndex, value, index, values) =>
        value > values[largestIndex] ? index : largestIndex,
      0,
    );
    roundedNetTotals[adjustmentIndex] = round2(
      roundedNetTotals[adjustmentIndex] + residual,
    );
  }

  return items.map((item, index) => ({
    ...item,
    net_total: roundedNetTotals[index],
  }));
}
