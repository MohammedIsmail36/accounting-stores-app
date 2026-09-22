import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(
  process.cwd(),
  "src/components/inventory-reconciliation/InventoryJournalPlanPreview.tsx",
), "utf8");

describe("InventoryJournalPlanPreview boundary", () => {
  it("يعيد استخدام جدول واحد لعرض حسابات المدين والدائن بأسمائها الفعلية", () => {
    expect(source).toContain('supabase.from("accounts")');
    expect(source).toContain("accountCode");
    expect(source).toContain("مدين");
    expect(source).toContain("دائن");
    expect(source).toContain("formatCurrency");
  });
});
