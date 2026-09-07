import { describe, expect, it } from "vitest";
import {
  buildSalesCogsByInvoice,
  computeSalesReportMetrics,
  getDocumentAmountExcludingTax,
  getSalesLineNetAmount,
} from "./metrics";

describe("buildSalesCogsByInvoice", () => {
  it("aggregates sale cost movements by their invoice reference", () => {
    expect(
      buildSalesCogsByInvoice([
        {
          reference_type: "sales_invoice",
          reference_id: "inv-1",
          movement_type: "sale",
          total_cost: 40,
        },
        {
          reference_type: "sales_invoice",
          reference_id: "inv-1",
          movement_type: "sale",
          total_cost: "2.50",
        },
        {
          reference_type: "sales_invoice",
          reference_id: "inv-2",
          movement_type: "sale",
          total_cost: 10,
        },
      ]),
    ).toEqual({ "inv-1": 42.5, "inv-2": 10 });
  });

  it("ignores returns and movements that do not reference a sales invoice", () => {
    expect(
      buildSalesCogsByInvoice([
        {
          reference_type: "sales_return",
          reference_id: "inv-1",
          movement_type: "sale_return",
          total_cost: 20,
        },
        {
          reference_type: "sales_invoice",
          reference_id: null,
          movement_type: "sale",
          total_cost: 30,
        },
      ]),
    ).toEqual({});
  });
});

describe("computeSalesReportMetrics", () => {
  it("يعيد قيماً صفرية وهامشاً غير قابل للحساب عند عدم وجود بيانات", () => {
    expect(
      computeSalesReportMetrics({ invoices: [], returns: [], movements: [] }),
    ).toEqual({
      invoiceCount: 0,
      returnCount: 0,
      invoiceTotalIncludingTax: 0,
      returnTotalIncludingTax: 0,
      salesRevenueExcludingTax: 0,
      returnRevenueExcludingTax: 0,
      netSalesRevenue: 0,
      salesCogs: 0,
      returnCogs: 0,
      netCogs: 0,
      grossProfit: 0,
      grossMarginPercent: null,
    });
  });

  it("يستبعد الضريبة ويعكس تكلفة المرتجعات عند حساب الربح", () => {
    const result = computeSalesReportMetrics({
      invoices: [{ status: "posted", total: 1150, tax: 150 }],
      returns: [{ status: "posted", total: 230, tax: 30 }],
      movements: [
        { movement_type: "sale", total_cost: 600 },
        { movement_type: "sale_return", total_cost: 100 },
      ],
    });

    expect(result.salesRevenueExcludingTax).toBe(1000);
    expect(result.returnRevenueExcludingTax).toBe(200);
    expect(result.netSalesRevenue).toBe(800);
    expect(result.netCogs).toBe(500);
    expect(result.grossProfit).toBe(300);
    expect(result.grossMarginPercent).toBe(37.5);
  });

  it("لا يُدخل المسودات والملغاة في النتائج المالية", () => {
    const result = computeSalesReportMetrics({
      invoices: [
        { status: "posted", total: 100, tax: 0 },
        { status: "draft", total: 500, tax: 0 },
        { status: "cancelled", total: 900, tax: 0 },
      ],
      returns: [
        { status: "posted", total: 20, tax: 0 },
        { status: "draft", total: 80, tax: 0 },
      ],
      movements: [],
    });

    expect(result.invoiceCount).toBe(1);
    expect(result.returnCount).toBe(1);
    expect(result.netSalesRevenue).toBe(80);
  });

  it("يقبل المرتجع كمستند مستقل بلا أي ارتباط بفاتورة", () => {
    const result = computeSalesReportMetrics({
      invoices: [],
      returns: [{ status: "posted", total: 250, tax: 0 }],
      movements: [{ movement_type: "sale_return", total_cost: 160 }],
    });

    expect(result.netSalesRevenue).toBe(-250);
    expect(result.netCogs).toBe(-160);
    expect(result.grossProfit).toBe(-90);
    expect(result.grossMarginPercent).toBeNull();
  });

  it("يتعامل مع النصوص الرقمية ويقرب القيم المالية إلى منزلتين", () => {
    const result = computeSalesReportMetrics({
      invoices: [{ status: "posted", total: "105250", tax: "0" }],
      returns: [{ status: "posted", total: "3130", tax: null }],
      movements: [
        { movement_type: "sale", total_cost: "71300.84" },
        { movement_type: "sale_return", total_cost: "2019.1091" },
      ],
    });

    expect(result.netSalesRevenue).toBe(102120);
    expect(result.netCogs).toBe(69281.73);
    expect(result.grossProfit).toBe(32838.27);
  });

  it("يعتمد إجمالي المستند كما هو لأن الخصومات مضمّنة فيه", () => {
    const result = computeSalesReportMetrics({
      invoices: [{ status: "posted", total: 900, tax: 0 }],
      returns: [],
      movements: [],
    });

    expect(result.salesRevenueExcludingTax).toBe(900);
    expect(result.grossProfit).toBe(900);
    expect(result.grossMarginPercent).toBeNull();
  });
});

describe("getSalesLineNetAmount", () => {
  it("يحافظ على net_total الصفري ولا يستبدله بـ total", () => {
    expect(getSalesLineNetAmount({ net_total: 0, total: 100 })).toBe(0);
  });

  it("يستخدم total فقط عندما تكون net_total غير موجودة", () => {
    expect(getSalesLineNetAmount({ net_total: null, total: "75.25" })).toBe(
      75.25,
    );
  });
});

describe("getDocumentAmountExcludingTax", () => {
  it("يطرح الضريبة ويقرب الناتج المالي", () => {
    expect(getDocumentAmountExcludingTax({ total: "115.555", tax: "15.55" })).toBe(
      100.01,
    );
  });
});
