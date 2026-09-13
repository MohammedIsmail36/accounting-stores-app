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

  it("لا تجمع المنتجات والحركات داخل المتصفح", () => {
    expect(source).not.toContain("fetchAllPaged");
    expect(source).not.toContain('.from("inventory_movements")');
    expect(source).not.toContain('.from("products")');
  });

  it("لا تسمح بمزامنة كمية المنتج أو أي كتابة مباشرة", () => {
    expect(source).not.toContain(".update(");
    expect(source).not.toContain("تأكيد المزامنة");
    expect(source).not.toContain("syncRow");
  });
});
