import { describe, expect, it } from "vitest";
import { buildSalesReportChart } from "./chart";
import type {
  CategorySalesGroup,
  CustomerSalesGroup,
  ProductSalesGroup,
  TimeSalesGroup,
} from "./grouping";

const emptyInput = {
  timeMode: "daily" as const,
  timeData: [] as TimeSalesGroup[],
  customerData: [] as CustomerSalesGroup[],
  productData: [] as ProductSalesGroup[],
  categoryData: [] as CategorySalesGroup[],
};

describe("buildSalesReportChart", () => {
  it("uses every time period and its already-calculated net value", () => {
    const timeData = [
      { label: "2026-08-01", net: 90 },
      { label: "2026-08-02", net: -20 },
    ] as TimeSalesGroup[];

    const chart = buildSalesReportChart({
      ...emptyInput,
      groupBy: "time",
      timeData,
    });

    expect(chart.meta?.title).toContain("اليومي");
    expect(chart.data).toEqual([
      { name: "2026-08-01", "صافي المبيعات": 90 },
      { name: "2026-08-02", "صافي المبيعات": -20 },
    ]);
  });

  it("derives customer chart values from sales minus standalone returns", () => {
    const customerData = Array.from({ length: 11 }, (_, index) => ({
      name: index === 0 ? "اسم عميل طويل يتجاوز ثمانية عشر حرفاً" : `عميل ${index}`,
      total: 100 - index,
      returns: index,
    })) as CustomerSalesGroup[];

    const chart = buildSalesReportChart({
      ...emptyInput,
      groupBy: "customer",
      customerData,
    });

    expect(chart.data).toHaveLength(10);
    expect(chart.data[0]).toEqual({
      name: "اسم عميل طويل يتجا…",
      "صافي المبيعات": 100,
    });
  });

  it("uses the net fields produced by product and category grouping", () => {
    const product = buildSalesReportChart({
      ...emptyInput,
      groupBy: "product",
      productData: [{ name: "منتج", revenue: -15 }] as ProductSalesGroup[],
    });
    const category = buildSalesReportChart({
      ...emptyInput,
      groupBy: "category",
      categoryData: [{ name: "تصنيف", net: 45 }] as CategorySalesGroup[],
    });

    expect(product.data[0]["صافي المبيعات"]).toBe(-15);
    expect(category.data[0]["صافي المبيعات"]).toBe(45);
  });

  it("does not create a chart for document-level views", () => {
    expect(
      buildSalesReportChart({ ...emptyInput, groupBy: "invoice" }),
    ).toEqual({ meta: null, data: [] });
    expect(
      buildSalesReportChart({ ...emptyInput, groupBy: "return" }),
    ).toEqual({ meta: null, data: [] });
  });
});
