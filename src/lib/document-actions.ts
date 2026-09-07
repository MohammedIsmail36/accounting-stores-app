import { supabase } from "@/integrations/supabase/client";

/**
 * طبقة مشتركة لعمليات المستندات (فواتير البيع/الشراء والمرتجعات).
 * لا تحتوي أي منطق محاسبي — فقط توحيد الاستدعاءات المتكررة حرفيًا في النماذج.
 */

/** هل التاريخ يقع داخل فترة مقفلة؟ (نفس المقارنة المستخدمة سابقًا في كل نموذج) */
export function isPeriodLocked(
  documentDate: string,
  lockedUntilDate?: string | null,
): boolean {
  return Boolean(lockedUntilDate) && documentDate <= (lockedUntilDate as string);
}

function errorMessage(err: unknown): string | undefined {
  return (err as { message?: string } | null)?.message;
}

export interface DocumentRpcResult {
  success: boolean;
  error?: string;
  /** true إذا كان الفشل خطأ اتصال/قاعدة بيانات وليس رفضًا منطقيًا من الدالة. */
  isException?: boolean;
  [key: string]: unknown;
}

/**
 * استدعاء دوال قاعدة البيانات التي تُعيد `{ success, error }`.
 * لا ترفع استثناءً: أي خطأ شبكة/قاعدة بيانات يُعاد كـ `{ success: false, isException: true }`.
 */
export async function invokeDocumentRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<DocumentRpcResult> {
  try {
    const { data, error } = await (supabase.rpc as any)(fn, args);
    if (error) return { success: false, error: errorMessage(error), isException: true };
    const res = data as DocumentRpcResult | null;
    if (!res?.success) return { success: false, error: res?.error };
    return { ...res, success: true };
  } catch (error) {
    return { success: false, error: errorMessage(error), isException: true };
  }
}


export interface DeleteDraftOptions {
  /** جدول البنود (مثال: `sales_invoice_items`) */
  itemsTable: string;
  /** جدول المستند الأب (مثال: `sales_invoices`) */
  parentTable: string;
  /** عمود الربط في جدول البنود (`invoice_id` أو `return_id`) */
  parentKey: "invoice_id" | "return_id";
  /** معرّف المستند */
  id: string;
}

/** حذف مسودة مستند: بنوده أولًا ثم المستند نفسه (يرفع الخطأ للمُستدعي). */
export async function deleteDraftDocument({
  itemsTable,
  parentTable,
  parentKey,
  id,
}: DeleteDraftOptions): Promise<void> {
  const { error: itemsError } = await (supabase.from(itemsTable as any) as any)
    .delete()
    .eq(parentKey, id);
  if (itemsError) throw itemsError;

  const { error: parentError } = await (supabase.from(parentTable as any) as any)
    .delete()
    .eq("id", id);
  if (parentError) throw parentError;
}
