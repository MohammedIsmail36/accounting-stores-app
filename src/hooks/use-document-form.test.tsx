import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { useDocumentFormState } from "./use-document-form";

vi.mock("@/lib/notify", () => ({
  notify: { error: vi.fn(), success: vi.fn() },
}));

import { notify } from "@/lib/notify";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

describe("useDocumentFormState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("يبدأ نظيفًا وغير محفوظ", () => {
    const { result } = renderHook(() => useDocumentFormState(), { wrapper });
    expect(result.current.saving).toBe(false);
    expect(result.current.isDirty).toBe(false);
  });

  it("markDirty ثم markClean يعكسان حالة التعديلات", () => {
    const { result } = renderHook(() => useDocumentFormState(), { wrapper });
    act(() => result.current.markDirty());
    expect(result.current.isDirty).toBe(true);
    act(() => result.current.markClean());
    expect(result.current.isDirty).toBe(false);
  });

  it("runAction ينفّذ العملية ويعيد true", async () => {
    const { result } = renderHook(() => useDocumentFormState(), { wrapper });
    const action = vi.fn().mockResolvedValue(undefined);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.runAction(action);
    });
    expect(ok).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.saving).toBe(false);
  });

  it("runAction يعرض رسالة الاستثناء ويعيد false", async () => {
    const { result } = renderHook(() => useDocumentFormState(), { wrapper });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.runAction(async () => {
        throw new Error("فشل الحفظ");
      });
    });
    expect(ok).toBe(false);
    expect(notify.error).toHaveBeenCalledWith("خطأ", "فشل الحفظ");
    expect(result.current.saving).toBe(false);
  });

  it("runAction يستخدم الرسالة الاحتياطية عند غياب رسالة الخطأ", async () => {
    const { result } = renderHook(() => useDocumentFormState(), { wrapper });
    await act(async () => {
      await result.current.runAction(
        async () => {
          throw {};
        },
        { fallbackError: "تعذر التنفيذ" },
      );
    });
    expect(notify.error).toHaveBeenCalledWith("خطأ", "تعذر التنفيذ");
  });

  it("ensurePeriodUnlocked يسمح عندما لا يوجد قفل", () => {
    const { result } = renderHook(() => useDocumentFormState({ lockedUntilDate: null }), { wrapper });
    expect(result.current.ensurePeriodUnlocked("2026-01-01", () => "msg")).toBe(true);
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("ensurePeriodUnlocked يمنع التاريخ داخل الفترة المقفلة ويعرض الرسالة", () => {
    const { result } = renderHook(
      () => useDocumentFormState({ lockedUntilDate: "2026-06-30" }),
      { wrapper },
    );
    const allowed = result.current.ensurePeriodUnlocked(
      "2026-06-30",
      (until) => `مقفلة حتى ${until}`,
    );
    expect(allowed).toBe(false);
    expect(notify.error).toHaveBeenCalledWith("الفترة مقفلة", "مقفلة حتى 2026-06-30");
  });

  it("ensurePeriodUnlocked يسمح بتاريخ بعد القفل", () => {
    const { result } = renderHook(
      () => useDocumentFormState({ lockedUntilDate: "2026-06-30" }),
      { wrapper },
    );
    expect(result.current.ensurePeriodUnlocked("2026-07-01", () => "msg")).toBe(true);
  });
});
