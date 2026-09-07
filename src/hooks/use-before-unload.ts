import { useEffect } from "react";

/**
 * يعرض تحذير المتصفح عند محاولة مغادرة الصفحة (إغلاق التاب/تحديث) مع تغييرات غير محفوظة.
 */
export function useBeforeUnload(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // مطلوب للمتصفحات الحديثة لإظهار نافذة التأكيد
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);
}
