import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { ReactNode } from "react";
import { useNavigationGuard } from "./use-navigation-guard";

/**
 * اختبارات تكامل: تتأكد أن حارس التنقل لا يحجب التنقل بعد عمليات
 * "الترحيل" أو "إلغاء الترحيل" الناجحة في فواتير الشراء/البيع/المرتجعات،
 * حيث يقوم الكود بـ: setIsDirty(false) + navGuard.allowNext() قبل التنقل.
 */

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={["/purchases/new"]}>{children}</MemoryRouter>;
}

/**
 * Hook اختباري يحاكي نموذج الفاتورة: يحمل isDirty + navGuard + navigate.
 */
function useFormSim(initialDirty: boolean) {
  const navigate = useNavigate();
  return { navigate, guard: useNavigationGuard(initialDirty) };
}

describe("useNavigationGuard - integration with posting flow", () => {
  beforeEach(() => {
    // إعادة الـ history لحالة نظيفة
    window.history.replaceState({}, "", "/purchases/new");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("يسمح بالتنقل بعد ترحيل ناجح: allowNext() ثم isDirty=false", async () => {
    const { result, rerender } = renderHook(
      ({ dirty }: { dirty: boolean }) => useFormSim(dirty),
      { wrapper, initialProps: { dirty: true } },
    );

    // محاكاة نجاح الترحيل: استدعاء allowNext() ثم تحديث isDirty=false
    act(() => {
      result.current.guard.allowNext();
    });
    rerender({ dirty: false });

    // محاولة التنقل بعد الترحيل - يجب ألا يُحجب
    act(() => {
      result.current.navigate("/purchases");
    });

    expect(result.current.guard.isBlocked).toBe(false);
  });

  it("يسمح بالتنقل بعد إلغاء ترحيل ناجح بنفس النمط", () => {
    const { result, rerender } = renderHook(
      ({ dirty }: { dirty: boolean }) => useFormSim(dirty),
      { wrapper, initialProps: { dirty: true } },
    );

    // محاكاة handleCancelPosted: setIsDirty(false) + allowNext() ثم loadData
    act(() => {
      result.current.guard.allowNext();
    });
    rerender({ dirty: false });

    act(() => {
      result.current.navigate("/sales");
    });

    expect(result.current.guard.isBlocked).toBe(false);
  });

  it("لا يحجب التنقل عندما يكون isDirty=false من الأساس (نموذج محفوظ/معتمد)", () => {
    const { result } = renderHook(
      ({ dirty }: { dirty: boolean }) => useFormSim(dirty),
      { wrapper, initialProps: { dirty: false } },
    );

    act(() => {
      result.current.navigate("/sales-returns");
    });

    expect(result.current.guard.isBlocked).toBe(false);
  });

  it("allowNext() يصفّر isDirtyRef الداخلي لمنع الحجب حتى قبل تطبيق re-render", () => {
    // سيناريو: handler يستدعي allowNext() ثم navigate() مباشرة
    // قبل أن يتمكن React من إعادة تصيير isDirty=false
    const { result } = renderHook(
      ({ dirty }: { dirty: boolean }) => useFormSim(dirty),
      { wrapper, initialProps: { dirty: true } },
    );

    act(() => {
      result.current.guard.allowNext();
      result.current.navigate("/purchases");
    });

    expect(result.current.guard.isBlocked).toBe(false);
  });
});
