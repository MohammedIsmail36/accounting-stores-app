import { describe, it, expect } from "vitest";
import { formatDisplayNumber } from "./posted-number-utils";

describe("formatDisplayNumber", () => {
  it("مرحّل — يعرض البادئة مع الرقم بـ 4 خانات", () => {
    expect(formatDisplayNumber("INV-", 5, 3, "posted")).toBe("INV-0005");
  });

  it("مسودة — يعرض # مع رقم المسودة", () => {
    expect(formatDisplayNumber("INV-", null, 3, "draft")).toBe("#3");
  });

  it("ملغي — يعرض نفس تنسيق المرحّل", () => {
    expect(formatDisplayNumber("INV-", 5, 3, "cancelled")).toBe("INV-0005");
  });

  it("أرقام كبيرة — لا يُقطع الرقم", () => {
    expect(formatDisplayNumber("INV-", 1000, 1, "posted")).toBe("INV-1000");
  });

  it("بادئة شراء — يعمل مع أي بادئة", () => {
    expect(formatDisplayNumber("PUR-", 42, 10, "posted")).toBe("PUR-0042");
  });
});
