import { supabase } from "@/integrations/supabase/client";

const messages: Record<string, string> = {
  INVENTORY_DRAFT_DELETE_PERMISSION_DENIED: "حذف مسودة التسوية متاح للمدير فقط.",
  INVENTORY_DRAFT_DELETE_INPUT_INVALID: "بيانات حذف المسودة غير مكتملة؛ حدّث الصفحة.",
  INVENTORY_DRAFT_DELETE_NOT_FOUND: "لم تعد المسودة موجودة؛ حدّث القائمة.",
  INVENTORY_DRAFT_DELETE_STATUS_CHANGED: "تغيرت حالة التسوية أو رُحّلت؛ حدّث الصفحة، ولم يُحذف شيء.",
  INVENTORY_DRAFT_DELETE_VERSION_CHANGED: "عُدلت المسودة في جلسة أخرى؛ حدّث الصفحة قبل الحذف.",
};

export async function deleteInventoryAdjustmentDraft(
  id: string,
  expectedUpdatedAt: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("delete_inventory_adjustment_draft" as never, {
    p_adjustment_id: id,
    p_expected_updated_at: expectedUpdatedAt,
  } as never);
  if (error) {
    const code = Object.keys(messages).find((key) => error.message.includes(key));
    throw code ? new Error(messages[code], { cause: error }) : error;
  }
  if (!data || typeof data !== "object"
    || (data as Record<string, unknown>).deleted !== true
    || (data as Record<string, unknown>).adjustment_id !== id) {
    throw new Error("نتيجة حذف المسودة غير متوقعة؛ حدّث القائمة للتحقق قبل المحاولة مجددًا.");
  }
}
