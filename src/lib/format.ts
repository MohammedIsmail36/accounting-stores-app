import { format, parseISO } from "date-fns";

/**
 * تنسيق رقمي موحّد (بدون عملة) — يحافظ على الإشارة السالبة.
 * استُخرج من التعريفات المحلية المكرّرة في الصفحات (formatNum / fmtNum).
 */
export function formatNumber(value: number | null | undefined, decimals = 2): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return (0).toFixed(decimals);
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** عدد صحيح بفواصل الآلاف (للكميات والأعداد) */
export function formatInt(value: number | null | undefined): string {
  return formatNumber(value, 0);
}

/** نسبة مئوية موحّدة */
export function formatPercent(value: number | null | undefined, decimals = 1): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return `0%`;
  return `${n.toFixed(decimals)}%`;
}

/**
 * تنسيق عملة بعملة صريحة.
 * ملاحظة: داخل المكوّنات استخدم `formatCurrency` من SettingsContext
 * حتى تُقرأ عملة الشركة من الإعدادات بدل تثبيتها نصياً.
 */
export function formatMoney(value: number | null | undefined, currency: string): string {
  return `${formatNumber(value)} ${currency}`;
}

/** تاريخ للعرض: yyyy-MM-dd (يتقبّل Date أو نص ISO) */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  try {
    const d = typeof value === "string" ? parseISO(value) : value;
    return format(d, "yyyy-MM-dd");
  } catch {
    return typeof value === "string" ? value : "—";
  }
}

/** تاريخ ووقت للعرض */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  try {
    const d = typeof value === "string" ? parseISO(value) : value;
    return format(d, "yyyy-MM-dd HH:mm");
  } catch {
    return typeof value === "string" ? value : "—";
  }
}
