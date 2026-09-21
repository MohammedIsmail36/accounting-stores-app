import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/pages/reports/InventoryReconciliationPage.tsx"),
  "utf8",
);

describe("InventoryReconciliationPage data boundary", () => {
  it("تقرأ من مصدر التشخيص الموحد", () => {
    expect(source).toContain('supabase.rpc("get_inventory_reconciliation_diagnostic"');
  });

  it("لا تجمع كميات المنتجات والحركات داخل المتصفح", () => {
    expect(source).not.toContain("fetchAllPaged");
    expect(source).not.toContain('.from("inventory_movements")');
    expect(source).not.toContain('.from("products")');
    expect(source).toContain("loadInventoryProductIdentities");
  });

  it("لا تسمح بمزامنة كمية المنتج أو أي كتابة مباشرة", () => {
    expect(source).not.toContain(".update(");
    expect(source).not.toContain("تأكيد المزامنة");
    expect(source).not.toContain("syncRow");
  });

  it("تستخدم هوية المنتج المشتركة وتخفي إعداد المسودة عن السجل المطابق", () => {
    expect(source).toContain("formatProductDisplay(row.name, row.brandName, row.modelNumber, row.code)");
    expect(source).toContain("canPrepareInventoryRepairDraft(row)");
    expect(source).not.toContain("row.canPrepareRepair ?");
  });
});
