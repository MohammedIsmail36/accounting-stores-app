import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestTimeout } from "./request-timeout";

describe("createRequestTimeout", () => {
  afterEach(() => vi.useRealTimers());

  it("يلغي الإشارة عند انتهاء المهلة ويميز سبب الإلغاء", () => {
    vi.useFakeTimers();
    const timeout = createRequestTimeout(20_000);

    expect(timeout.signal.aborted).toBe(false);
    expect(timeout.didTimeout()).toBe(false);
    vi.advanceTimersByTime(20_000);
    expect(timeout.signal.aborted).toBe(true);
    expect(timeout.didTimeout()).toBe(true);
  });

  it("لا يلغي الطلب بعد تنظيف المؤقت", () => {
    vi.useFakeTimers();
    const timeout = createRequestTimeout(20_000);
    timeout.clear();
    vi.advanceTimersByTime(20_000);

    expect(timeout.signal.aborted).toBe(false);
    expect(timeout.didTimeout()).toBe(false);
  });

  it("يرفض المهلة غير الصالحة", () => {
    expect(() => createRequestTimeout(0)).toThrow("مهلة الطلب");
  });
});
