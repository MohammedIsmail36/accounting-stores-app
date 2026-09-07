import { describe, it, expect } from "vitest";
import { calcInvoiceTotals } from "./invoice-totals";

describe("calcInvoiceTotals", () => {
  it("بدون خصم أو ضريبة — يحسب الإجمالي فقط", () => {
    const result = calcInvoiceTotals({
      items: [{ total: 100, discount: 0 }],
      showTax: false,
      taxRate: 0,
    });
    expect(result.subtotal).toBe(100);
    expect(result.grandTotal).toBe(100);
    expect(result.taxAmount).toBe(0);
    expect(result.afterDiscount).toBe(100);
    expect(result.discountMode).toBe("none");
  });

  it("مع ضريبة 15%", () => {
    const result = calcInvoiceTotals({
      items: [{ total: 1000, discount: 0 }],
      showTax: true,
      taxRate: 15,
    });
    expect(result.subtotal).toBe(1000);
    expect(result.taxAmount).toBe(150);
    expect(result.grandTotal).toBe(1150);
  });

  it("خصم على مستوى البند — discountMode = line", () => {
    const result = calcInvoiceTotals({
      items: [{ total: 100, discount: 10 }],
      showTax: false,
      taxRate: 0,
    });
    expect(result.subtotal).toBe(100);
    expect(result.hasLineDiscount).toBe(true);
    expect(result.discountMode).toBe("line");
    expect(result.afterDiscount).toBe(100); // line discount already applied in total
  });

  it("خصم على مستوى الفاتورة — يُخصم من الإجمالي", () => {
    const result = calcInvoiceTotals({
      items: [{ total: 1000, discount: 0 }],
      invoiceDiscount: 50,
      showTax: false,
      taxRate: 0,
    });
    expect(result.subtotal).toBe(1000);
    expect(result.hasInvoiceDiscount).toBe(true);
    expect(result.discountMode).toBe("invoice");
    expect(result.afterDiscount).toBe(950);
    expect(result.grandTotal).toBe(950);
  });

  it("خصم بند + ضريبة — الضريبة على subtotal (الخصم مضمّن في total)", () => {
    const result = calcInvoiceTotals({
      items: [{ total: 1000, discount: 100 }],
      showTax: true,
      taxRate: 15,
    });
    expect(result.subtotal).toBe(1000);
    expect(result.discountMode).toBe("line");
    expect(result.afterDiscount).toBe(1000); // no invoice discount
    expect(result.taxAmount).toBe(150); // 15% of 1000
    expect(result.grandTotal).toBe(1150);
  });

  it("خصم فاتورة + ضريبة — الضريبة على (subtotal - invoiceDiscount)", () => {
    const result = calcInvoiceTotals({
      items: [{ total: 1000, discount: 0 }],
      invoiceDiscount: 100,
      showTax: true,
      taxRate: 15,
    });
    expect(result.afterDiscount).toBe(900);
    expect(result.taxAmount).toBe(135); // 15% of 900
    expect(result.grandTotal).toBe(1035);
  });

  it("بند واحد فقط", () => {
    const result = calcInvoiceTotals({
      items: [{ total: 500, discount: 0 }],
      showTax: false,
      taxRate: 0,
    });
    expect(result.subtotal).toBe(500);
    expect(result.grandTotal).toBe(500);
  });

  it("عدة بنود — يجمع الإجماليات", () => {
    const result = calcInvoiceTotals({
      items: [
        { total: 200, discount: 0 },
        { total: 300, discount: 0 },
        { total: 500, discount: 0 },
      ],
      showTax: false,
      taxRate: 0,
    });
    expect(result.subtotal).toBe(1000);
    expect(result.grandTotal).toBe(1000);
  });

  it("قيم صفرية — كل شيء = 0", () => {
    const result = calcInvoiceTotals({
      items: [{ total: 0, discount: 0 }],
      showTax: false,
      taxRate: 0,
    });
    expect(result.subtotal).toBe(0);
    expect(result.afterDiscount).toBe(0);
    expect(result.taxAmount).toBe(0);
    expect(result.grandTotal).toBe(0);
  });

  it("خصم فاتورة = الإجمالي — grandTotal = 0", () => {
    const result = calcInvoiceTotals({
      items: [{ total: 1000, discount: 0 }],
      invoiceDiscount: 1000,
      showTax: true,
      taxRate: 15,
    });
    expect(result.afterDiscount).toBe(0);
    expect(result.taxAmount).toBe(0);
    expect(result.grandTotal).toBe(0);
  });

  it("ضريبة معطلة showTax=false — taxAmount = 0 حتى لو taxRate > 0", () => {
    const result = calcInvoiceTotals({
      items: [{ total: 1000, discount: 0 }],
      showTax: false,
      taxRate: 15,
    });
    expect(result.taxAmount).toBe(0);
    expect(result.grandTotal).toBe(1000);
  });

  it("نسبة ضريبة 0% — taxAmount = 0", () => {
    const result = calcInvoiceTotals({
      items: [{ total: 1000, discount: 0 }],
      showTax: true,
      taxRate: 0,
    });
    expect(result.taxAmount).toBe(0);
    expect(result.grandTotal).toBe(1000);
  });

  it("أرقام عشرية — لا floating point errors", () => {
    const result = calcInvoiceTotals({
      items: [
        { total: 33.33, discount: 0 },
        { total: 33.33, discount: 0 },
        { total: 33.33, discount: 0 },
      ],
      showTax: false,
      taxRate: 0,
    });
    expect(result.subtotal).toBe(99.99);
    expect(result.grandTotal).toBe(99.99);
  });

  it("قيم كبيرة — يحسب بشكل صحيح", () => {
    const result = calcInvoiceTotals({
      items: [{ total: 1000000, discount: 0 }],
      showTax: true,
      taxRate: 15,
    });
    expect(result.subtotal).toBe(1000000);
    expect(result.taxAmount).toBe(150000);
    expect(result.grandTotal).toBe(1150000);
  });
});
