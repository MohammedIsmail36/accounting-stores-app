import { describe, expect, it } from "vitest";
import { buildSalesExportSummary } from "./export-summary";

const baseInput = {
  kpi: {
    count: 2,
    grossSales: 4_160,
    returnsTotal: 160,
    netSales: 4_000,
    cogs: 2_700,
    grossProfit: 1_300,
    grossMarginPercent: 32.5,
    cashCollected: 3_000,
    cashCollectionRate: 72.12,
    returnSettled: 200,
    totalCovered: 3_200,
  },
  overdueInfo: { count: 1, total: 960 },
  discountTaxInfo: { discount: 40, tax: 624 },
  targetInfo: { pct: 3.466 },
};

describe("buildSalesExportSummary", () => {
  it("exports the same financial and coverage KPIs with stable formatting", () => {
    const cards = buildSalesExportSummary(baseInput);

    expect(cards[0]).toEqual({
      label: "نطاق الملخص المالي",
      value: "المستندات المُرحّلة فقط",
    });
    expect(cards).toContainEqual({ label: "إجمالي الربح", value: "1,300.00" });
    expect(cards).toContainEqual({ label: "هامش الربح", value: "32.5%" });
    expect(cards).toContainEqual({
      label: "نسبة التحصيل النقدي من الفواتير شامل الضريبة",
      value: "72.1%",
    });
    expect(cards).toContainEqual({
      label: "متوسط الفاتورة قبل الضريبة",
      value: "2,080.00",
    });
    expect(cards).toContainEqual({
      label: "المتأخرات",
      value: "960.00 (1 فاتورة)",
    });
    expect(cards.at(-1)).toEqual({ label: "تحقيق الهدف", value: "3.5%" });
  });

  it("uses an em dash for undefined rates and omits an absent target", () => {
    const cards = buildSalesExportSummary({
      ...baseInput,
      kpi: {
        ...baseInput.kpi,
        count: 0,
        grossSales: 0,
        grossMarginPercent: null,
        cashCollectionRate: null,
      },
      targetInfo: null,
    });

    expect(cards).toContainEqual({ label: "هامش الربح", value: "—" });
    expect(cards).toContainEqual({
      label: "نسبة التحصيل النقدي من الفواتير شامل الضريبة",
      value: "—",
    });
    expect(cards).toContainEqual({
      label: "متوسط الفاتورة قبل الضريبة",
      value: "0.00",
    });
    expect(cards.some(({ label }) => label === "تحقيق الهدف")).toBe(false);
  });

  it("includes the selected customer scope only when a filter is active", () => {
    const cards = buildSalesExportSummary({
      ...baseInput,
      customerScope: "عميل 1",
    });

    expect(cards).toContainEqual({ label: "نطاق العميل", value: "عميل 1" });
    expect(
      buildSalesExportSummary(baseInput).some(
        ({ label }) => label === "نطاق العميل",
      ),
    ).toBe(false);
  });
});
