import { distributeNetTotals } from "@/lib/invoice-totals";

/** الحد الأدنى من الحقول المطلوبة لحفظ سطر مستند (فاتورة أو مرتجع). */
export interface PersistableLineItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
}

export interface BuildLineRowsOptions {
  /** اسم عمود الربط: `invoice_id` للفواتير أو `return_id` للمرتجعات. */
  parentKey: "invoice_id" | "return_id";
  /** معرّف المستند الأب. */
  parentId: string;
  /** الخصم/التخفيض على مستوى المستند ليُوزّع تناسبيًا (خصم عام + خصم ولاء). */
  reduction?: number;
  /** أساس التوزيع؛ الافتراضي مجموع إجماليات السطور. */
  base?: number;
}

export interface BuildLinePayloadsOptions {
  /** الخصم/التخفيض على مستوى المستند ليُوزّع تناسبيًا (خصم عام + خصم ولاء). */
  reduction?: number;
  /** أساس التوزيع؛ الافتراضي مجموع إجماليات السطور. */
  base?: number;
}

/** صف جاهز للإدراج في جداول بنود الفواتير/المرتجعات. */
export type LineItemRow = Record<string, unknown>;

/**
 * يبني بيانات البنود من دون مفتاح المستند الأب، لاستخدامها مع عمليات الحفظ
 * الذرّية التي تنشئ معرّف المستند داخل قاعدة البيانات.
 */
export function buildLineItemPayloads<T extends PersistableLineItem>(
  items: T[],
  { reduction = 0, base }: BuildLinePayloadsOptions = {},
): LineItemRow[] {
  return distributeNetTotals(items, reduction, base).map((i, idx) => ({
    product_id: i.product_id,
    description: i.product_name,
    quantity: i.quantity,
    unit_price: i.unit_price,
    discount: i.discount,
    total: i.total,
    net_total: i.net_total,
    sort_order: idx,
  }));
}

/**
 * يبني صفوف البنود الجاهزة للإدراج: يوزّع الخصم العام على `net_total`
 * ويحفظ ترتيب الإدخال في `sort_order` (مصدر الحقيقة لترتيب السطور).
 */
export function buildLineItemRows<T extends PersistableLineItem>(
  items: T[],
  { parentKey, parentId, reduction = 0, base }: BuildLineRowsOptions,
): LineItemRow[] {
  return buildLineItemPayloads(items, { reduction, base }).map((item) => ({
    [parentKey]: parentId,
    ...item,
  }));
}
