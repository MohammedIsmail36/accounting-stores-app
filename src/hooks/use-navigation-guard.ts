import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useBeforeUnload } from "./use-before-unload";

type PendingNav =
  | { type: "push" | "replace"; url: string }
  | { type: "pop"; delta: number };

/**
 * يعترض التنقل الداخلي (React Router عبر BrowserRouter) عند وجود تغييرات غير محفوظة.
 * يعمل عن طريق تغليف history.pushState/replaceState ومراقبة popstate.
 */
export function useNavigationGuard(isDirty: boolean) {
  useBeforeUnload(isDirty);

  const navigate = useNavigate();
  const location = useLocation();
  const isDirtyRef = useRef(isDirty);
  const allowNextRef = useRef(false);
  const pendingRef = useRef<PendingNav | null>(null);

  const [isBlocked, setIsBlocked] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return;

    const originalPush = window.history.pushState.bind(window.history);
    const originalReplace = window.history.replaceState.bind(window.history);

    const wrap = (
      type: "push" | "replace",
      original: typeof window.history.pushState,
    ) =>
      function (this: History, data: any, unused: string, url?: string | URL | null) {
        if (
          isDirtyRef.current &&
          !allowNextRef.current &&
          url &&
          typeof url === "string" &&
          url !== location.pathname + location.search + location.hash
        ) {
          pendingRef.current = { type, url };
          setIsBlocked(true);
          return;
        }
        return original(data, unused, url ?? null);
      };

    window.history.pushState = wrap("push", originalPush) as typeof window.history.pushState;
    window.history.replaceState = wrap(
      "replace",
      originalReplace,
    ) as typeof window.history.replaceState;

    const handlePopState = (e: PopStateEvent) => {
      if (isDirtyRef.current && !allowNextRef.current) {
        // المستخدم استخدم زر الرجوع - أعد الحالة وأظهر الحوار
        // ملاحظة: لا يمكن معرفة الـ delta بدقة، نفترض -1
        pendingRef.current = { type: "pop", delta: -1 };
        // أعد المستخدم إلى الموقع الحالي
        originalPush({}, "", location.pathname + location.search + location.hash);
        setIsBlocked(true);
      }
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.history.pushState = originalPush;
      window.history.replaceState = originalReplace;
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isDirty, location.pathname, location.search, location.hash]);

  const cancel = useCallback(() => {
    pendingRef.current = null;
    setIsBlocked(false);
  }, []);

  const proceed = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setIsBlocked(false);
    if (!pending) return;
    allowNextRef.current = true;
    // إعطاء React وقت لمعالجة isDirty=false إن وُجد، ثم التنقل
    requestAnimationFrame(() => {
      if (pending.type === "pop") {
        window.history.go(pending.delta);
      } else {
        navigate(pending.url);
      }
      // إعادة العلم بعد التنقل
      setTimeout(() => {
        allowNextRef.current = false;
      }, 50);
    });
  }, [navigate]);

  const saveAndLeave = useCallback(
    async (saveFn: () => Promise<boolean | void> | boolean | void) => {
      setSaving(true);
      try {
        const result = await saveFn();
        if (result === false) return;
        proceed();
      } finally {
        setSaving(false);
      }
    },
    [proceed],
  );

  /**
   * يسمح بالتنقل التالي دون عرض حوار التحذير.
   * استخدمها قبل navigate() مباشرة بعد الحفظ الناجح.
   */
  const allowNext = useCallback(() => {
    allowNextRef.current = true;
    isDirtyRef.current = false;
    setTimeout(() => {
      allowNextRef.current = false;
    }, 100);
  }, []);

  return {
    isBlocked,
    cancel,
    confirm: proceed,
    saveAndLeave,
    saving,
    allowNext,
  };
}
