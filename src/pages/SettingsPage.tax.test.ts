import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/pages/SettingsPage.tsx"), "utf8");

describe("عقد واجهة إعدادات الضريبة", () => {
  it("يعرض الحسابين النظاميين للقراءة فقط ولا يعرض منتقي حساب", () => {
    expect(source).toContain("حساب ضريبة المخرجات (2104)");
    expect(source).toContain("حساب ضريبة المدخلات (1105)");
    expect(source).toContain("حساب نظام محمي — للقراءة فقط");
    expect(source).not.toContain("AccountCombobox");
    expect(source).not.toContain("مثال: 2102");
  });

  it("يستبعد الربط الداخلي من طلب الحفظ", () => {
    expect(source).toContain("buildCompanySettingsUpdatePayload(settings)");
  });
});
