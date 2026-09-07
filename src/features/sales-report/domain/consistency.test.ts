import { describe, expect, it } from "vitest";
import { buildAggregateSalesExport } from "./aggregate-export";
import { buildSalesReportChart } from "./chart";
import {
  buildSalesDocumentScopes,
  filterFinancialSalesMovements,
} from "./document-scope";
import { buildSalesExportSummary } from "./export-summary";
import {
  buildCategorySalesGroups,
  buildCustomerSalesGroups,
  buildProductSalesGroups,
  buildTimeSalesGroups,
} from "./grouping";
import { computeSalesReportMetrics } from "./metrics";

const invoices = [
  {
    id: "invoice-1",
    status: "posted",
    invoice_date: "2026-08-01",
    customer_id: "customer-1",
    customer: { name: "عميل 1" },
    total: 92,
    tax: 2,
    items: [
      {
        product_id: "product-1",
        product: {
          name: "منتج 1",
          category_id: "category-1",
          category: { name: "تصنيف 1" },
        },
        quantity: 1,
        net_total: 60,
      },
      {
        product_id: "product-2",
        product: {
          name: "منتج 2",
          category_id: "category-1",
          category: { name: "تصنيف 1" },
        },
        quantity: 1,
        net_total: 40,
      },
    ],
  },
  {
    id: "invoice-2",
    status: "posted",
    invoice_date: "2026-08-02",
    customer_id: "customer-2",
    customer: { name: "عميل 2" },
    total: 50,
    tax: 0,
    items: [
      {
        product_id: "product-3",
        product: {
          name: "منتج بلا تكلفة",
          category_id: "category-2",
          category: { name: "تصنيف بلا تكلفة" },
        },
        quantity: 1,
        net_total: 50,
      },
    ],
  },
  {
    id: "invoice-draft",
    status: "draft",
    invoice_date: "2026-08-02",
    customer_id: "customer-draft",
    total: 999,
    tax: 0,
    items: [{ product_id: "product-draft", quantity: 1, net_total: 999 }],
  },
];

const returns = [
  {
    id: "return-1",
    status: "posted",
    return_date: "2026-08-01",
    customer_id: "customer-1",
    customer: { name: "عميل 1" },
    total: 18,
    tax: 0,
    items: [
      {
        product_id: "product-1",
        product: {
          name: "منتج 1",
          category_id: "category-1",
          category: { name: "تصنيف 1" },
        },
        quantity: 1,
        net_total: 20,
      },
    ],
  },
];

const movements = [
  {
    movement_type: "sale",
    reference_type: "sales_invoice",
    reference_id: "invoice-1",
    movement_date: "2026-08-01",
    product_id: "product-1",
    total_cost: 30,
  },
  {
    movement_type: "sale",
    reference_type: "sales_invoice",
    reference_id: "invoice-1",
    movement_date: "2026-08-01",
    product_id: "product-2",
    total_cost: 20,
  },
  {
    movement_type: "sale_return",
    reference_type: "sales_return",
    reference_id: "return-1",
    movement_date: "2026-08-01",
    product_id: "product-1",
    total_cost: 10,
  },
  {
    movement_type: "sale",
    reference_type: "sales_invoice",
    reference_id: "invoice-draft",
    movement_date: "2026-08-02",
    product_id: "product-draft",
    total_cost: 900,
  },
];

const sum = <T>(rows: T[], value: (row: T) => number) =>
  rows.reduce((total, row) => total + value(row), 0);

const sumExportColumn = (
  config: { headers: string[]; rows: (string | number)[][] },
  header: string,
) => {
  const index = config.headers.indexOf(header);
  expect(index).toBeGreaterThanOrEqual(0);
  return config.rows.reduce(
    (total, row) => total + (typeof row[index] === "number" ? row[index] : 0),
    0,
  );
};

describe("sales report cross-view consistency", () => {
  it("keeps summary, dimensions, charts, and exports on the same net and profit", () => {
    const financialInvoices = buildSalesDocumentScopes(invoices, "all")
      .financialDocuments;
    const financialReturns = buildSalesDocumentScopes(returns, "all")
      .financialDocuments;
    const financialMovements = filterFinancialSalesMovements(
      financialInvoices,
      financialReturns,
      movements,
    );
    const metrics = computeSalesReportMetrics({
      invoices: financialInvoices,
      returns: financialReturns,
      movements: financialMovements,
    });
    const customerData = buildCustomerSalesGroups(
      financialInvoices,
      financialReturns,
      () => ({ cashCollected: 0, returnSettled: 0 }),
    );
    const productData = buildProductSalesGroups(
      financialInvoices,
      financialReturns,
      financialMovements,
    );
    const categoryData = buildCategorySalesGroups(
      financialInvoices,
      financialReturns,
      financialMovements,
      true,
    );
    const timeData = buildTimeSalesGroups(
      financialInvoices,
      financialReturns,
      financialMovements,
      "daily",
      true,
    );

    expect(metrics.netSalesRevenue).toBe(122);
    expect(metrics.grossProfit).toBe(82);
    expect(sum(customerData, (row) => row.total - row.returns)).toBe(122);
    expect(sum(productData, (row) => row.revenue)).toBe(122);
    expect(sum(categoryData, (row) => row.net)).toBe(122);
    expect(sum(timeData, (row) => row.net)).toBe(122);
    expect(sum(productData, (row) => row.revenue - row.cogs)).toBe(82);
    expect(sum(categoryData, (row) => row.profit)).toBe(82);
    expect(sum(timeData, (row) => row.profit)).toBe(82);
    expect(categoryData.find((row) => row.id === "category-2")?.margin).toBeNull();
    expect(timeData.find((row) => row.key === "2026-08-02")?.margin).toBeNull();

    for (const groupBy of ["customer", "product", "category", "time"] as const) {
      const chart = buildSalesReportChart({
        groupBy,
        timeMode: "daily",
        customerData,
        productData,
        categoryData,
        timeData,
      });
      expect(sum(chart.data, (row) => row["صافي المبيعات"])).toBe(122);
    }

    const commonExportInput = {
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
      timeMode: "daily" as const,
      isPostedOnly: true,
      customerData,
      productData,
      categoryData,
      timeData,
    };
    const customerExport = buildAggregateSalesExport({
      ...commonExportInput,
      groupBy: "customer",
    });
    const productExport = buildAggregateSalesExport({
      ...commonExportInput,
      groupBy: "product",
    });
    const categoryExport = buildAggregateSalesExport({
      ...commonExportInput,
      groupBy: "category",
    });
    const timeExport = buildAggregateSalesExport({
      ...commonExportInput,
      groupBy: "time",
    });

    expect(sumExportColumn(customerExport, "الصافي")).toBe(122);
    expect(sumExportColumn(productExport, "الإيرادات الصافية")).toBe(122);
    expect(sumExportColumn(categoryExport, "صافي الإيرادات")).toBe(122);
    expect(sumExportColumn(timeExport, "صافي المبيعات")).toBe(122);
    expect(sumExportColumn(productExport, "الربح")).toBe(82);
    expect(sumExportColumn(categoryExport, "الربح")).toBe(82);
    expect(sumExportColumn(timeExport, "الربح")).toBe(82);
    expect(categoryExport.rows.find((row) => row[0] === "تصنيف بلا تكلفة")?.at(-2)).toBe(
      "—",
    );
    expect(timeExport.rows.find((row) => row[0] === "2026-08-02")?.at(-2)).toBe(
      "—",
    );

    const summary = buildSalesExportSummary({
      kpi: {
        count: metrics.invoiceCount,
        grossSales: metrics.salesRevenueExcludingTax,
        returnsTotal: metrics.returnRevenueExcludingTax,
        netSales: metrics.netSalesRevenue,
        cogs: metrics.netCogs,
        grossProfit: metrics.grossProfit,
        grossMarginPercent: metrics.grossMarginPercent,
        cashCollected: 0,
        cashCollectionRate: null,
        returnSettled: 0,
        totalCovered: 0,
      },
      overdueInfo: { count: 0, total: 0 },
      discountTaxInfo: { discount: 0, tax: 2 },
      targetInfo: null,
    });
    expect(
      summary.find(({ label }) => label === "صافي المبيعات قبل الضريبة")
        ?.value,
    ).toBe("122.00");
    expect(summary.find(({ label }) => label === "إجمالي الربح")?.value).toBe(
      "82.00",
    );
  });
});
