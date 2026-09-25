import { supabase } from "@/integrations/supabase/client";
import type { InventoryAdjustmentReasonCode } from "@/lib/inventory-adjustment-reasons";

export type InventoryAdjustmentDraftItem = {
  product_id: string;
  system_quantity: number;
  actual_quantity: number;
  unit_cost: number;
  notes: string;
  reason_code: InventoryAdjustmentReasonCode | null;
  reason_reference: string | null;
};

export type InventoryAdjustmentDraftInput = {
  id: string | null;
  expectedUpdatedAt: string | null;
  date: string;
  description: string;
  items: InventoryAdjustmentDraftItem[];
};

export type InventoryAdjustmentDraftResult = {
  adjustment_id: string;
  adjustment_number: number;
  updated_at: string;
  status: "draft";
};

const messages: Record<string, string> = {
  INVENTORY_DRAFT_PERMISSION_DENIED: "ليس لديك صلاحية حفظ تسوية المخزون.",
  INVENTORY_DRAFT_INPUT_INVALID: "بيانات المسودة غير مكتملة أو عدد البنود غير صالح.",
  INVENTORY_DRAFT_ITEM_INVALID: "أحد بنود المسودة غير صالح؛ راجع الكمية والتكلفة.",
  INVENTORY_DRAFT_DUPLICATE_PRODUCT: "لا يمكن إضافة المنتج نفسه مرتين في التسوية.",
  INVENTORY_DRAFT_PRODUCT_UNAVAILABLE: "أحد المنتجات غير متاح؛ أعد اختيار المنتج.",
  INVENTORY_DRAFT_STOCK_CHANGED: "تغير رصيد أحد المنتجات منذ فتح المسودة؛ حدّث الصفحة قبل الحفظ.",
  INVENTORY_DRAFT_VERSION_CHANGED: "عُدلت المسودة في جلسة أخرى؛ حدّث الصفحة قبل الحفظ.",
  INVENTORY_DRAFT_STATUS_CHANGED: "تغيرت حالة التسوية؛ حدّث الصفحة قبل الحفظ.",
  INVENTORY_DRAFT_NOT_FOUND: "التسوية غير موجودة؛ حدّث القائمة.",
  INVENTORY_DRAFT_REASON_INVALID: "سبب الفرق غير معروف؛ اختر سببًا من القائمة.",
  INVENTORY_DRAFT_REASON_REQUIRED: "حدد سببًا واكتب ملاحظة لكل بند ذي فرق.",
  INVENTORY_DRAFT_REASON_REFERENCE_INVALID: "اكتب مرجع المستند الأصلي لتصحيح خطأ سابق فقط.",
  INVENTORY_DRAFT_REASON_ITEM_MISMATCH: "تعذر ربط سبب الفرق ببند التسوية؛ تحقق من المسودة.",
};

export async function saveInventoryAdjustmentDraft(
  input: InventoryAdjustmentDraftInput,
): Promise<InventoryAdjustmentDraftResult> {
  const { data, error } = await supabase.rpc("save_inventory_adjustment_draft_with_reasons" as never, {
    p_adjustment_id: input.id,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_adjustment_date: input.date,
    p_description: input.description,
    p_items: input.items,
  } as never);
  if (error) {
    const code = Object.keys(messages).find((key) => error.message.includes(key));
    throw code ? new Error(messages[code], { cause: error }) : error;
  }
  if (!data || typeof data !== "object") {
    throw new Error("لم تُرجع قاعدة البيانات نتيجة حفظ صالحة؛ تحقق من المسودة قبل المحاولة مجددًا.");
  }
  const result = data as Record<string, unknown>;
  if (result.status !== "draft" || typeof result.adjustment_id !== "string"
    || typeof result.adjustment_number !== "number"
    || typeof result.updated_at !== "string") {
    throw new Error("نتيجة حفظ المسودة غير متوقعة؛ تحقق من السجل قبل المحاولة مجددًا.");
  }
  return result as InventoryAdjustmentDraftResult;
}
