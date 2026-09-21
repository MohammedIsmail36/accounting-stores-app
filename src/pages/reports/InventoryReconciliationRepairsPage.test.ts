import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/pages/reports/InventoryReconciliationRepairsPage.tsx"),
  "utf8",
);

describe("InventoryReconciliationRepairsPage boundary", () => {
  it("تقرأ سجل المعالجات فقط مع ترقيم خادمي", () => {
    expect(source).toContain('supabase.from("inventory_reconciliation_repairs"');
    expect(source).toContain('{ count: "exact" }');
    expect(source).toContain(".range(from, to)");
  });

  it("لا تنفذ أو تعدل أي معالجة في نسخة السجل الأولى", () => {
    expect(source).not.toContain("execute_inventory_reconciliation_repair");
    expect(source).not.toContain(".insert(");
    expect(source).not.toContain(".update(");
    expect(source).not.toContain(".delete(");
  });

  it("تفصل الموضوع عن سبب المعالجة وتحافظ على صف مضغوط", () => {
    expect(source).toContain('accessorKey: "title"');
    expect(source).toContain('accessorKey: "explanation"');
    expect(source).toContain('header: "سبب المعالجة"');
    expect(source).toContain("compactRows");
  });
});
