import { describe, expect, it } from "vitest";
import { computeInvoiceCoverage } from "./collections";

describe("computeInvoiceCoverage", () => {
  it("يفصل التحصيل النقدي عن تسوية المرتجعات ويستخدم الإجمالي شامل الضريبة", () => {
    const result = computeInvoiceCoverage(
      [{ id: "i1", status: "posted", total: 1150 }],
      [{ invoice_id: "i1", allocated_amount: 700 }],
      [{ invoice_id: "i1", settled_amount: 150 }],
    );

    expect(result.invoiceGrossTotal).toBe(1150);
    expect(result.cashCollected).toBe(700);
    expect(result.returnSettled).toBe(150);
    expect(result.totalCovered).toBe(850);
    expect(result.outstanding).toBe(300);
    expect(result.cashCollectionRate).toBe(60.87);
    expect(result.totalCoverageRate).toBe(73.91);
    expect(result.byInvoice.i1).toEqual({
      cashCollected: 700,
      returnSettled: 150,
      totalCovered: 850,
    });
  });

  it("لا يخفي التجاوز بقص النسبة إلى 100%", () => {
    const result = computeInvoiceCoverage(
      [{ id: "i1", status: "posted", total: 100 }],
      [{ invoice_id: "i1", allocated_amount: 110 }],
      [],
    );

    expect(result.cashCollectionRate).toBe(110);
    expect(result.outstanding).toBe(-10);
  });

  it("يستبعد الفواتير غير المرحلة وأي تخصيص لا يخص عينة التقرير", () => {
    const result = computeInvoiceCoverage(
      [
        { id: "posted", status: "posted", total: "200" },
        { id: "draft", status: "draft", total: 900 },
      ],
      [
        { invoice_id: "posted", allocated_amount: "50" },
        { invoice_id: "draft", allocated_amount: 500 },
        { invoice_id: "outside", allocated_amount: 400 },
      ],
      [{ invoice_id: "posted", settled_amount: null }],
    );

    expect(result.invoiceGrossTotal).toBe(200);
    expect(result.cashCollected).toBe(50);
    expect(result.returnSettled).toBe(0);
  });

  it("يعيد نسبة غير قابلة للحساب عند عدم وجود فواتير مرحلة", () => {
    const result = computeInvoiceCoverage([], [], []);
    expect(result.cashCollectionRate).toBeNull();
    expect(result.totalCoverageRate).toBeNull();
  });
});
