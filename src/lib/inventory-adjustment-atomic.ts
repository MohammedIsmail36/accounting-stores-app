import { supabase } from "@/integrations/supabase/client";

type VarianceRpcName =
  | "post_inventory_adjustment_atomic"
  | "reverse_inventory_adjustment_atomic";
const varianceRpc = supabase.rpc as unknown as (
  name: VarianceRpcName,
  args: Record<string, string>,
) => Promise<{ data: unknown; error: Error | null }>;

export type InventoryAdjustmentAtomicResult = {
  status: "posted" | "cancelled";
  operation_id: string;
  journal_entry_id: string | null;
  repeated: boolean;
};

const databaseMessages: Record<string, string> = {
  INVENTORY_VARIANCE_PRECONDITION_CHANGED: "تغيرت كمية المنتج أو حركاته منذ حفظ المسودة؛ أعد مراجعة البنود قبل الترحيل.",
  INVENTORY_VARIANCE_PERIOD_LOCKED: "الفترة المحاسبية مقفلة؛ لا يمكن تنفيذ العملية بهذا التاريخ.",
  INVENTORY_VARIANCE_REASON_REQUIRED: "اكتب سبب الفرق في ملاحظات كل بند غير مطابق.",
  INVENTORY_VARIANCE_ITEMS_INVALID: "بنود التسوية غير مكتملة أو تحتوي منتجًا مكررًا.",
  INVENTORY_VARIANCE_PRODUCT_UNAVAILABLE: "أحد المنتجات غير متاح؛ أعد مراجعة التسوية.",
  INVENTORY_VARIANCE_NEGATIVE_STOCK: "ستؤدي العملية إلى كمية مخزون سالبة.",
  INVENTORY_VARIANCE_REVERSAL_NEGATIVE_STOCK: "لا يمكن عكس التسوية لأن الكمية المتاحة لم تعد كافية.",
  INVENTORY_VARIANCE_COST_REQUIRED: "لا توجد تكلفة موثوقة للمنتج؛ راجع حركات شرائه قبل الترحيل.",
  INVENTORY_VARIANCE_BOOK_VALUE_INVALID: "رصيد تكلفة المنتج لا يطابق كميته؛ راجعه في مطابقة المخزون.",
  INVENTORY_VARIANCE_PRECISION_REVIEW_REQUIRED: "تحتاج قيمة المنتج إلى مراجعة فرق التقريب قبل تصفير كميته.",
  INVENTORY_VARIANCE_ACCOUNT_INVALID: "أحد حسابات التسوية المحمية غير جاهز؛ راجع إعداد الحسابات.",
  INVENTORY_VARIANCE_PERMISSION_DENIED: "ليس لديك صلاحية ترحيل تسوية المخزون.",
  INVENTORY_VARIANCE_REVERSAL_PERMISSION_DENIED: "إلغاء التسوية المرحّلة متاح للمدير فقط.",
  INVENTORY_VARIANCE_ORIGINAL_JOURNAL_CHANGED: "تغير القيد الأصلي؛ أوقف العكس وراجعه محاسبيًا.",
  INVENTORY_VARIANCE_REVERSAL_JOURNAL_INVALID: "القيد الأصلي غير صالح للعكس التلقائي؛ راجعه محاسبيًا.",
  INVENTORY_VARIANCE_LEGACY_POSTED_DOCUMENT: "هذه تسوية قديمة؛ لا يمكن تمريرها عبر مسار التسويات الجديدة.",
  INVENTORY_VARIANCE_SOURCE_STATUS_INVALID: "حالة التسوية تغيرت؛ حدّث الصفحة وتحقق من السجل.",
  INVENTORY_VARIANCE_REVERSAL_STATUS_INVALID: "لا يمكن عكس التسوية في حالتها الحالية.",
  INVENTORY_VARIANCE_SOURCE_NOT_FOUND: "التسوية غير موجودة أو لم يعد الوصول إليها متاحًا.",
  INVENTORY_VARIANCE_REQUEST_CONFLICT: "تعارضت محاولة التنفيذ مع عملية أخرى؛ حدّث الصفحة وتحقق من السجل.",
};

function translateDatabaseError(error: Error): Error {
  const code = Object.keys(databaseMessages).find((key) => error.message.includes(key));
  return code ? new Error(databaseMessages[code], { cause: error }) : error;
}

function parseResult(
  value: unknown,
  expectedStatus: InventoryAdjustmentAtomicResult["status"],
): InventoryAdjustmentAtomicResult {
  if (!value || typeof value !== "object") {
    throw new Error("لم تُرجع قاعدة البيانات نتيجة صالحة للتسوية");
  }
  const result = value as Record<string, unknown>;
  if (
    result.status !== expectedStatus ||
    typeof result.operation_id !== "string" ||
    (result.journal_entry_id !== null &&
      typeof result.journal_entry_id !== "string") ||
    typeof result.repeated !== "boolean"
  ) {
    throw new Error("نتيجة عملية التسوية غير متوقعة؛ تحقق من السجل قبل إعادة المحاولة");
  }
  return result as InventoryAdjustmentAtomicResult;
}

/** Reuse requestId when retrying an uncertain network result. Never send costs or journal lines from the browser. */
export async function postInventoryAdjustmentAtomic(
  adjustmentId: string,
  requestId: string,
): Promise<InventoryAdjustmentAtomicResult> {
  const { data, error } = await varianceRpc(
    "post_inventory_adjustment_atomic",
    { p_adjustment_id: adjustmentId, p_request_id: requestId },
  );
  if (error) throw translateDatabaseError(error);
  return parseResult(data, "posted");
}

/** The reason is required by the database and remains on the reversal audit record. */
export async function reverseInventoryAdjustmentAtomic(
  adjustmentId: string,
  requestId: string,
  reason: string,
): Promise<InventoryAdjustmentAtomicResult> {
  if (!reason.trim()) throw new Error("اكتب سبب إلغاء التسوية");
  const { data, error } = await varianceRpc(
    "reverse_inventory_adjustment_atomic",
    { p_adjustment_id: adjustmentId, p_request_id: requestId, p_reason: reason.trim() },
  );
  if (error) throw translateDatabaseError(error);
  return parseResult(data, "cancelled");
}
