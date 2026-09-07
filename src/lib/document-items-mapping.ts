import { formatProductDisplay } from "@/lib/product-utils";

/**
 * تحويل صفوف بنود المستندات القادمة من قاعدة البيانات إلى سطور النموذج.
 * نفس المنطق كان مكرّرًا حرفيًا في نماذج فواتير البيع/الشراء والمرتجعات.
 */

export interface LoadedItemProductRelation {
  name?: string | null;
  code?: string | null;
  model_number?: string | null;
  purchase_price?: number | null;
  product_brands?: { name?: string | null } | null;
}

export interface LoadedItemRow {
  id: string;
  product_id?: string | null;
  description?: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  products?: LoadedItemProductRelation | null;
}

export interface MappedLineItem {
  id?: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  /** يُضاف فقط عند `withCostPrice` (يُستخدم لحساب هامش الربح في المبيعات والمرتجعات) */
  cost_price?: number;
}

/** اسم العرض الموحّد للمنتج، أو وصف البند إن لم يكن مرتبطًا بمنتج. */
function displayName(row: LoadedItemRow): string {
  const product = row.products;
  if (!product) return row.description || "";
  return formatProductDisplay(
    product.name ?? "",
    product.product_brands?.name ?? undefined,
    product.model_number ?? undefined,
    product.code ?? undefined,
  );
}

export function mapLoadedLineItems<T extends MappedLineItem = MappedLineItem>(
  rows: LoadedItemRow[] | null | undefined,
  options?: { withCostPrice?: boolean },
): T[] {
  return (rows || []).map((row) => {
    const item: MappedLineItem = {
      id: row.id,
      product_id: row.product_id || "",
      product_name: displayName(row),
      quantity: row.quantity,
      unit_price: row.unit_price,
      discount: row.discount,
      total: row.total,
    };
    if (options?.withCostPrice) {
      item.cost_price = Number(row.products?.purchase_price) || 0;
    }
    return item as T;
  });
}
