import { describe, it, expect } from "vitest";
import { calcMargin } from "./margin-utils";

describe("calcMargin — Profit Margin vs Markup", () => {
  it("شراء 140 وبيع 192: هامش الربح 27.1% و Markup 37.1%", () => {
    const r = calcMargin(192, 140);
    expect(r.profit).toBe(52);
    expect(r.marginPct).toBeCloseTo(27.083, 2);
    expect(r.markupPct).toBeCloseTo(37.143, 2);
    expect(r.marginPct.toFixed(1)).toBe("27.1");
    expect(r.markupPct.toFixed(1)).toBe("37.1");
  });

  it("هامش الربح ≠ Markup (لا يجب الخلط بينهما)", () => {
    const r = calcMargin(192, 140);
    expect(r.marginPct).not.toBeCloseTo(r.markupPct, 1);
  });

  it("بيع 100 وتكلفة 50: هامش 50% و Markup 100%", () => {
    const r = calcMargin(100, 50);
    expect(r.profit).toBe(50);
    expect(r.marginPct).toBe(50);
    expect(r.markupPct).toBe(100);
  });

  it("بيع يساوي التكلفة: لا ربح", () => {
    const r = calcMargin(100, 100);
    expect(r.profit).toBe(0);
    expect(r.marginPct).toBe(0);
    expect(r.markupPct).toBe(0);
  });

  it("بيع أقل من التكلفة: قيم سالبة", () => {
    const r = calcMargin(80, 100);
    expect(r.profit).toBe(-20);
    expect(r.marginPct).toBeCloseTo(-25, 2);
    expect(r.markupPct).toBeCloseTo(-20, 2);
  });

  it("سعر البيع = 0: marginPct = 0 بدون قسمة على صفر", () => {
    const r = calcMargin(0, 100);
    expect(r.marginPct).toBe(0);
  });

  it("التكلفة = 0: markupPct = 0 بدون قسمة على صفر", () => {
    const r = calcMargin(100, 0);
    expect(r.markupPct).toBe(0);
    expect(r.marginPct).toBe(100);
  });

  it("كلاهما = 0: الكل صفر", () => {
    const r = calcMargin(0, 0);
    expect(r.profit).toBe(0);
    expect(r.marginPct).toBe(0);
    expect(r.markupPct).toBe(0);
  });

  it("متطابق مع صيغة تقرير المبيعات (Sales - COGS) / Sales", () => {
    const sales = 5000;
    const cogs = 3000;
    const r = calcMargin(sales, cogs);
    const reportMargin = ((sales - cogs) / sales) * 100;
    expect(r.marginPct).toBeCloseTo(reportMargin, 6);
    expect(r.marginPct).toBe(40);
  });
});
