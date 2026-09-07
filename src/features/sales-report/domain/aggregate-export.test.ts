import { describe, expect, it } from "vitest";
import { buildAggregateSalesExport } from "./aggregate-export";
import type {
  CategorySalesGroup,
  CustomerSalesGroup,
  ProductSalesGroup,
  TimeSalesGroup,
} from "./grouping";

const emptyInput = {
  dateFrom: "2026-08-01",
  dateTo: "2026-08-31",
  timeMode: "daily" as const,
  isPostedOnly: true,
  customerData: [] as CustomerSalesGroup[],
  productData: [] as ProductSalesGroup[],
  categoryData: [] as CategorySalesGroup[],
  timeData: [] as TimeSalesGroup[],
};

const expectAlignedRows = (config: { headers: string[]; rows: unknown[][] }) => {
  config.rows.forEach((row) => expect(row).toHaveLength(config.headers.length));
};

describe("buildAggregateSalesExport", () => {
  it("exports customer net and coverage using explicit financial labels", () => {
    const config = buildAggregateSalesExport({
      ...emptyInput,
      groupBy: "customer",
      customerData: [
        {
          name: "عميل",
          count: 2,
          total: 1000,
          returns: 100,
          invoiceGrossTotal: 1150,
          cashCollected: 600,
          returnSettled: 50,
        },
      ] as CustomerSalesGroup[],
    });

    expect(config.headers[2]).toBe("المبيعات قبل الضريبة");
    expect(config.rows[0]).toEqual([
      "عميل", 2, 1000, 100, 900, 1150, 600, 50, 500, "52.2%",
    ]);
    expectAlignedRows(config);
  });

  it("matches the product table rule that margin needs positive revenue and cost", () => {
    const productData = [
      { name: "بتكلفة", qtySold: 2, qtyReturned: 0, revenue: 100, cogs: 60 },
      { name: "بلا تكلفة", qtySold: 1, qtyReturned: 0, revenue: 50, cogs: 0 },
      { name: "صافي سالب", qtySold: 0, qtyReturned: 1, revenue: -20, cogs: -10 },
    ] as ProductSalesGroup[];
    const config = buildAggregateSalesExport({
      ...emptyInput,
      groupBy: "product",
      productData,
    });

    expect(config.rows.map((row) => row.at(-1))).toEqual(["40.0%", "—", "—"]);
    expectAlignedRows(config);
  });

  it("keeps optional category profit columns aligned with posted-only mode", () => {
    const categoryData = [
      {
        name: "تصنيف",
        productCount: 1,
        qtySold: 2,
        qtyReturned: 1,
        revenue: 100,
        returns: 40,
        net: 60,
        cogs: 30,
        profit: 30,
        margin: 50,
        returnRate: 40,
        pctOfTotal: 100,
      },
    ] as CategorySalesGroup[];
    const posted = buildAggregateSalesExport({
      ...emptyInput,
      groupBy: "category",
      categoryData,
    });
    const all = buildAggregateSalesExport({
      ...emptyInput,
      groupBy: "category",
      categoryData,
      isPostedOnly: false,
    });

    expect(posted.headers).toContain("الربح");
    expect(all.headers).not.toContain("الربح");
    expectAlignedRows(posted);
    expectAlignedRows(all);
  });

  it("exports monthly return-only and growth states without column drift", () => {
    const timeData = [
      {
        label: "أغسطس 2026",
        count: 0,
        total: 0,
        returns: 25,
        net: -25,
        aov: 0,
        cogs: -10,
        profit: -15,
        margin: null,
        returnRate: null,
        growth: -12.34,
      },
    ] as TimeSalesGroup[];
    const config = buildAggregateSalesExport({
      ...emptyInput,
      groupBy: "time",
      timeMode: "monthly",
      timeData,
    });

    expect(config.sheetName).toBe("شهري");
    expect(config.rows[0][6]).toBe("مرتجع فقط");
    expect(config.rows[0].at(-1)).toBe("-12.3%");
    expectAlignedRows(config);
  });
});
