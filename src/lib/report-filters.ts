import type { FilterFn } from "@tanstack/react-table";

/**
 * فلتر بحث موحّد لصفوف تقارير المخزون:
 * يبحث في الكود، اسم الصنف، الماركة، الفئة، ورقم موديل المصنع، واسم المورد.
 */
export const productReportFilterFn: FilterFn<any> = (row, _columnId, value) => {
  const q = String(value ?? "").trim().toLowerCase();
  if (!q) return true;
  const r = row.original as Record<string, unknown>;
  const haystack = [
    r.code,
    r.name,
    r.brand_name,
    r.category_name,
    r.model_number,
    r.last_supplier_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
};
