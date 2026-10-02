import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const view = "inventory_movements_effective_cost";

describe("historical sale-cost read model", () => {
  it("routes cost-bearing UI readers through the effective-cost view", () => {
    const readers = [
      "src/hooks/use-dashboard-kpis.ts",
      "src/features/sales-report/hooks/use-sales-report-data.ts",
      "src/pages/reports/GrowthAnalytics.tsx",
      "src/pages/reports/CommissionCalculatorPage.tsx",
      "src/pages/reports/ProductAnalytics.tsx",
      "src/pages/reports/PurchasesReport.tsx",
      "src/pages/reports/SystemHealthPage.tsx",
      "src/pages/InventoryMovements.tsx",
      "src/pages/ProductView.tsx",
    ];
    for (const path of readers) {
      const code = source(path);
      expect(code, path).toContain(`.from("${view}")`);
      expect(code, path).not.toContain('.from("inventory_movements")');
    }
  });

  it("leaves movement writers on the original table", () => {
    for (const path of ["src/pages/PurchaseInvoiceForm.tsx", "src/pages/PurchaseReturnForm.tsx"])
      expect(source(path), path).toContain("inventory_movements");
  });

  it("requires an invoker-security view and a separately visible original cost", () => {
    const migration = source("supabase/migrations/20261001100000_historical_sale_cost_corrections.sql");
    expect(migration).toContain("security_invoker = true");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("original_total_cost");
    expect(migration).toContain("correction_cost");
    expect(migration).toContain("HISTORICAL_SALE_COST_APPEND_ONLY");
  });

  it("routes the diagnostic and financial summary functions without replacing GL checks", () => {
    const diagnostic = source("supabase/migrations/20261001102000_historical_sale_cost_diagnostic_reader.sql");
    const finance = source("supabase/migrations/20261001105000_historical_sale_cost_finance_readers.sql");
    expect(diagnostic.match(/FROM public\.inventory_movements_effective_cost m/g)?.length).toBe(6);
    expect(diagnostic).toContain("m.original_total_cost, m.correction_cost");
    expect(diagnostic).toContain("ledger_1104_balance");
    expect(finance.match(/FROM public\.inventory_movements_effective_cost/g)?.length).toBe(6);
  });
});
