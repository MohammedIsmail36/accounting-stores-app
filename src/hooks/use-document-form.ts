import { useCallback, useState } from "react";
import { useNavigationGuard } from "@/hooks/use-navigation-guard";
import { isPeriodLocked } from "@/lib/document-actions";
import { notify } from "@/lib/notify";

/**
 * حالة مشتركة لنماذج المستندات (فواتير البيع/الشراء والمرتجعات).
 * توحّد ما كان مكرّرًا حرفيًا في النماذج الأربعة:
 * - حالة الحفظ `saving` وحراسة التنفيذ المتزامن.
 * - علم التعديلات `isDirty` + حراسة التنقّل `useNavigationGuard`.
 * - `markClean()` = إيقاف التحذير + السماح بالتنقّل التالي بعد نجاح العملية.
 * - `ensurePeriodUnlocked()` = رسالة القفل الزمني الموحّدة.
 *
 * لا يحتوي أي منطق محاسبي أو استعلامات — كل نموذج يحتفظ بمنطقه الخاص.
 */
export interface UseDocumentFormStateOptions {
  /** تاريخ القفل الزمني من إعدادات الشركة (`locked_until_date`) */
  lockedUntilDate?: string | null;
}

export interface RunActionOptions {
  /** رسالة الخطأ الافتراضية إن لم يوفّر الاستثناء رسالة */
  fallbackError?: string;
}

export function useDocumentFormState(options?: UseDocumentFormStateOptions) {
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const navGuard = useNavigationGuard(isDirty);

  /** تعليم النموذج كنظيف بعد نجاح العملية والسماح بالتنقّل التالي بدون تحذير. */
  const markClean = useCallback(() => {
    setIsDirty(false);
    navGuard.allowNext();
  }, [navGuard]);

  /** تعليم النموذج كمعدّل (يُستخدم في `onInput` للحقول القابلة للتعديل). */
  const markDirty = useCallback(() => {
    setIsDirty((current) => (current ? current : true));
  }, []);

  /**
   * يمنع تنفيذ عملية على مستند بتاريخ داخل فترة مقفلة، مع نفس نص الرسالة السابق.
   * يُعيد `true` إذا كان التاريخ مسموحًا.
   */
  const ensurePeriodUnlocked = useCallback(
    (documentDate: string, message: (lockedUntil: string) => string): boolean => {
      const lockedUntil = options?.lockedUntilDate;
      if (!isPeriodLocked(documentDate, lockedUntil)) return true;
      notify.error("الفترة مقفلة", message(lockedUntil as string));
      return false;
    },
    [options?.lockedUntilDate],
  );

  /**
   * تشغيل عملية مستند: يمنع التنفيذ المتزامن، يضبط `saving`، ويعرض الخطأ بنفس الشكل السابق.
   * يُعيد `true` فقط عند اكتمال العملية دون استثناء.
   */
  const runAction = useCallback(
    async (action: () => Promise<void>, actionOptions?: RunActionOptions): Promise<boolean> => {
      if (saving) return false;
      setSaving(true);
      try {
        await action();
        return true;
      } catch (error) {
        const message = (error as { message?: string } | null)?.message;
        notify.error("خطأ", message || actionOptions?.fallbackError || "حدث خطأ غير متوقع");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [saving],
  );

  return {
    saving,
    setSaving,
    isDirty,
    setIsDirty,
    markDirty,
    markClean,
    navGuard,
    runAction,
    ensurePeriodUnlocked,
  };
}
