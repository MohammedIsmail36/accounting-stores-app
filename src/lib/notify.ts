import { toast as sonnerToast } from "sonner";
import { formatSupabaseError } from "./format-error";

/**
 * واجهة التنبيهات الموحّدة للنظام.
 * كل الشاشات يجب أن تستخدم `notify` بدلاً من استيراد sonner مباشرة
 * أو استخدام واجهة use-toast القديمة.
 */
export const notify = {
  success(message: string, description?: string) {
    return sonnerToast.success(message, { description });
  },

  info(message: string, description?: string) {
    return sonnerToast.info(message, { description });
  },

  warning(message: string, description?: string) {
    return sonnerToast.warning(message, { description });
  },

  /** رسالة خطأ نصية مباشرة */
  error(message: string, description?: string) {
    return sonnerToast.error(message, { description, duration: 4000 });
  },

  /**
   * خطأ قادم من قاعدة البيانات / الشبكة — يُترجم تلقائياً لرسالة عربية واضحة.
   * @param context عنوان قصير يوضح العملية الفاشلة (مثال: "تعذّر حذف العميل")
   */
  dbError(context: string, err: unknown, fallback?: string) {
    return sonnerToast.error(context, {
      description: formatSupabaseError(err, fallback),
      duration: 5000,
    });
  },

  dismiss(id?: string | number) {
    sonnerToast.dismiss(id);
  },
};
