import { describe, it, expect } from "vitest";
import { cn, toDateString, round2, toWesternDigits } from "./utils";

describe("cn (className merge utility)", () => {
  it("should merge class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("should handle conditional classes", () => {
    const isHidden = false;
    expect(cn("base", isHidden && "hidden", "visible")).toBe("base visible");
  });

  it("should merge conflicting Tailwind classes", () => {
    // tailwind-merge should keep the last one
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("should handle undefined and null", () => {
    expect(cn("base", undefined, null, "end")).toBe("base end");
  });

  it("should handle empty input", () => {
    expect(cn()).toBe("");
  });
});

describe("toDateString", () => {
  it("formats a known date correctly", () => {
    const date = new Date(2026, 0, 15); // January 15, 2026
    expect(toDateString(date)).toBe("2026-01-15");
  });

  it("pads single-digit months", () => {
    const date = new Date(2026, 2, 10); // March 10
    expect(toDateString(date)).toBe("2026-03-10");
  });

  it("pads single-digit days", () => {
    const date = new Date(2026, 11, 5); // December 5
    expect(toDateString(date)).toBe("2026-12-05");
  });

  it("handles end of year", () => {
    const date = new Date(2025, 11, 31); // December 31, 2025
    expect(toDateString(date)).toBe("2025-12-31");
  });
});

describe("round2", () => {
  it("الحالة الكلاسيكية 2.555 → 2.56", () => {
    expect(round2(2.555)).toBe(2.56);
  });

  it("صفر → 0", () => {
    expect(round2(0)).toBe(0);
  });

  it("أعداد سالبة", () => {
    expect(round2(-2.555)).toBe(-2.55);
  });

  it("أعداد كبيرة", () => {
    expect(round2(999999.995)).toBe(1000000);
  });

  it("0 منازل عشرية", () => {
    expect(round2(2.5, 0)).toBe(3);
  });

  it("3 منازل عشرية", () => {
    expect(round2(2.5555, 3)).toBe(2.556);
  });

  it("قيمة صغيرة جداً تُقرّب لـ 0", () => {
    expect(round2(0.001)).toBe(0);
  });

  it("floating point 0.1 + 0.2", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe("toWesternDigits", () => {
  it("يحوّل الأرقام العربية للغربية", () => {
    expect(toWesternDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
  });

  it("الأرقام الغربية تبقى كما هي", () => {
    expect(toWesternDigits("0123456789")).toBe("0123456789");
  });

  it("نص مختلط عربي وأرقام عربية", () => {
    expect(toWesternDigits("سعر ١٥٠ ريال")).toBe("سعر 150 ريال");
  });

  it("نص بدون أرقام لا يتغير", () => {
    expect(toWesternDigits("مرحبا")).toBe("مرحبا");
  });

  it("نص فارغ يبقى فارغاً", () => {
    expect(toWesternDigits("")).toBe("");
  });
});
