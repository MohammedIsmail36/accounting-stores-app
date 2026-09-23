import { describe, expect, it } from "vitest";
import {
  buildCompanySettingsUpdatePayload,
  SYSTEM_TAX_ACCOUNT_CODES,
} from "./tax-settings";

describe("إعدادات حسابات الضريبة النظامية", () => {
  it("يثبت رمزي المدخلات والمخرجات المعتمدين", () => {
    expect(SYSTEM_TAX_ACCOUNT_CODES).toEqual({ purchase: "1105", sales: "2104" });
  });

  it("لا يرسل حقلي حسابات الضريبة أو الحقول المدارة إلى طلب حفظ الإعدادات", () => {
    const payload = buildCompanySettingsUpdatePayload({
      id: "settings-id",
      created_at: "created",
      updated_at: "updated",
      singleton: true,
      purchase_tax_account_id: "1105-id",
      sales_tax_account_id: "2104-id",
      enable_tax: true,
      tax_rate: 14,
      company_name: "شركة اختبار",
    });

    expect(payload).toEqual({
      enable_tax: true,
      tax_rate: 14,
      company_name: "شركة اختبار",
    });
  });
});
