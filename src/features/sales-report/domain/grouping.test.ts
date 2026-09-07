import { describe, expect, it } from "vitest";
import {
  allocateSalesDocumentItems,
  buildCategorySalesGroups,
  buildCustomerSalesGroups,
  buildProductSalesGroups,
  buildTimeSalesGroups,
  groupSalesAndReturns,
} from "./grouping";

describe("allocateSalesDocumentItems", () => {
  it("allocates the document amount before tax and absorbs rounding on the last line", () => {
    const rows = allocateSalesDocumentItems({
      total: 2,
      tax: 0,
      items: [
        { product_id: "product-1", net_total: 1 },
        { product_id: "product-2", net_total: 1 },
        { product_id: "product-3", net_total: 1 },
      ],
    });

    expect(rows.map((row) => row.reportNetAmount)).toEqual([
      0.67, 0.67, 0.66,
    ]);
    expect(
      rows.reduce((total, row) => total + row.reportNetAmount, 0),
    ).toBe(2);
  });

  it("keeps the full document value when legacy line amounts are zero", () => {
    const rows = allocateSalesDocumentItems({
      total: 50,
      tax: 0,
      items: [
        { product_id: "product-1", net_total: 0 },
        { product_id: "product-2", net_total: 0 },
      ],
    });

    expect(rows.map((row) => row.reportNetAmount)).toEqual([50, 0]);
  });
});

describe("buildTimeSalesGroups", () => {
  it("groups monthly sales, standalone returns, cost, and growth", () => {
    const rows = buildTimeSalesGroups(
      [
        { invoice_date: "2026-01-15", total: 115, tax: 15 },
        { invoice_date: "2026-01-20", total: 230, tax: 30 },
        { invoice_date: "2026-02-01", total: 100, tax: 0 },
      ],
      [
        { return_date: "2026-01-23", total: 23, tax: 3 },
        { return_date: "2026-03-01", total: 50, tax: 0 },
      ],
      [
        { movement_date: "2026-01-15", movement_type: "sale", total_cost: 60 },
        {
          movement_date: "2026-01-23",
          movement_type: "sale_return",
          total_cost: 10,
        },
        { movement_date: "2026-02-01", movement_type: "sale", total_cost: 40 },
        {
          movement_date: "2026-03-01",
          movement_type: "sale_return",
          total_cost: 25,
        },
      ],
      "monthly",
      true,
    );

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        key: "2026-01",
        label: "يناير 2026",
        count: 2,
        total: 300,
        returns: 20,
        net: 280,
        cogs: 50,
        profit: 230,
        aov: 140,
        growth: null,
        returnOnly: false,
      }),
    );
    expect(rows[1].growth).toBeCloseTo(-64.2857, 4);
    expect(rows[2]).toEqual(
      expect.objectContaining({
        key: "2026-03",
        label: "مارس 2026",
        count: 0,
        net: -50,
        cogs: -25,
        profit: -25,
        growth: -150,
        returnOnly: true,
      }),
    );
  });

  it("ignores missing dates and hides cost outside the posted view", () => {
    const rows = buildTimeSalesGroups(
      [
        { invoice_date: "2026-01-01", total: 100 },
        { invoice_date: null, total: 999 },
      ],
      [{ return_date: null, total: 999 }],
      [
        { movement_date: "2026-01-01", movement_type: "sale", total_cost: 60 },
        { movement_date: null, movement_type: "sale", total_cost: 999 },
      ],
      "daily",
      false,
    );

    expect(rows).toEqual([
      expect.objectContaining({
        key: "2026-01-01",
        label: "2026-01-01",
        total: 100,
        cogs: 0,
        profit: 0,
        margin: null,
      }),
    ]);
  });
});

describe("buildCategorySalesGroups", () => {
  it("groups sales, standalone returns, and net cost by category", () => {
    const rows = buildCategorySalesGroups(
      [
        {
          items: [
            {
              product_id: "product-1",
              product: {
                name: "منتج 1",
                category_id: "category-1",
                category: { name: "ملابس" },
              },
              quantity: 3,
              net_total: 300,
            },
            {
              product_id: "product-2",
              product: {
                name: "منتج 2",
                category_id: "category-1",
                category: { name: "ملابس" },
              },
              quantity: 1,
              net_total: 100,
            },
          ],
        },
      ],
      [
        {
          items: [
            {
              product_id: "product-1",
              product: {
                name: "منتج 1",
                category_id: "category-1",
                category: { name: "ملابس" },
              },
              quantity: 1,
              net_total: 100,
            },
            {
              description: "منتج محذوف",
              quantity: 1,
              net_total: 50,
            },
          ],
        },
      ],
      [
        { product_id: "product-1", movement_type: "sale", total_cost: 180 },
        {
          product_id: "product-1",
          movement_type: "sale_return",
          total_cost: 60,
        },
        { product_id: "product-2", movement_type: "sale", total_cost: 50 },
      ],
      true,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        id: "category-1",
        name: "ملابس",
        productCount: 2,
        qtySold: 4,
        qtyReturned: 1,
        revenue: 400,
        returns: 100,
        net: 300,
        cogs: 170,
        profit: 130,
        returnOnly: false,
      }),
    );
    expect(rows[1]).toEqual(
      expect.objectContaining({
        id: "__none__",
        name: "بدون تصنيف",
        qtySold: 0,
        qtyReturned: 1,
        net: -50,
        returnOnly: true,
      }),
    );
  });

  it("does not expose cost metrics outside the posted view", () => {
    const [row] = buildCategorySalesGroups(
      [
        {
          items: [
            {
              product_id: "product-1",
              product: { category_id: "category-1" },
              quantity: 1,
              net_total: 100,
            },
          ],
        },
      ],
      [],
      [{ product_id: "product-1", movement_type: "sale", total_cost: 60 }],
      false,
    );

    expect(row).toEqual(
      expect.objectContaining({ cogs: 0, profit: 0, margin: null }),
    );
  });
});

describe("buildProductSalesGroups", () => {
  it("matches product and category revenue to document totals after document discounts", () => {
    const invoices = [
      {
        total: 90,
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
            net_total: 60,
          },
          {
            product_id: "product-2",
            product: {
              name: "منتج 2",
              category_id: "category-2",
              category: { name: "تصنيف 2" },
            },
            quantity: 1,
            net_total: 40,
          },
        ],
      },
    ];
    const returns = [
      {
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

    const products = buildProductSalesGroups(invoices, returns, []);
    const categories = buildCategorySalesGroups(invoices, returns, [], false);

    expect(products.find((row) => row.id === "product-1")).toEqual(
      expect.objectContaining({
        grossRevenue: 54,
        returnsRevenue: 18,
        revenue: 36,
      }),
    );
    expect(products.find((row) => row.id === "product-2")).toEqual(
      expect.objectContaining({
        grossRevenue: 36,
        returnsRevenue: 0,
        revenue: 36,
      }),
    );
    expect(products.reduce((total, row) => total + row.revenue, 0)).toBe(72);
    expect(categories.reduce((total, row) => total + row.net, 0)).toBe(72);
  });

  it("nets product quantities, revenue, and returned cost", () => {
    const rows = buildProductSalesGroups(
      [
        {
          items: [
            {
              product_id: "product-1",
              product: { name: "منتج" },
              quantity: 3,
              net_total: 300,
              total: 345,
            },
          ],
        },
      ],
      [
        {
          items: [
            {
              product_id: "product-1",
              product: { name: "منتج" },
              quantity: 1,
              net_total: 100,
              total: 115,
            },
          ],
        },
      ],
      [
        { product_id: "product-1", movement_type: "sale", total_cost: 180 },
        {
          product_id: "product-1",
          movement_type: "sale_return",
          total_cost: 60,
        },
      ],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        id: "product-1",
        qtySold: 3,
        qtyReturned: 1,
        grossRevenue: 300,
        returnsRevenue: 100,
        revenue: 200,
        cogs: 120,
        returnOnly: false,
        reconciliationStatus: null,
      }),
    ]);
  });

  it("keeps a standalone return for a deleted product", () => {
    const rows = buildProductSalesGroups(
      [],
      [{ items: [{ description: "بند قديم", quantity: 2, total: 50 }] }],
      [],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        id: "__desc__بند قديم",
        name: "بند قديم",
        qtySold: 0,
        qtyReturned: 2,
        revenue: -50,
        returnOnly: true,
        reconciliationStatus: "return_only",
      }),
    ]);
  });

  it("labels a fully returned product and a return price difference", () => {
    const rows = buildProductSalesGroups(
      [
        {
          items: [
            { product_id: "balanced", quantity: 1, net_total: 100 },
            { product_id: "different", quantity: 2, net_total: 253.22 },
          ],
        },
      ],
      [
        {
          items: [
            { product_id: "balanced", quantity: 1, net_total: 100 },
            { product_id: "different", quantity: 2, net_total: 260 },
          ],
        },
      ],
      [],
    );

    expect(
      rows.find((row) => row.id === "balanced")?.reconciliationStatus,
    ).toBe("fully_returned");
    expect(
      rows.find((row) => row.id === "different")?.reconciliationStatus,
    ).toBe("return_price_difference");
  });
});

describe("buildCustomerSalesGroups", () => {
  it("combines posted sales, returns, and invoice coverage by customer", () => {
    const rows = buildCustomerSalesGroups(
      [
        {
          id: "inv-1",
          customer_id: "customer-1",
          customer: { name: "أحمد" },
          status: "posted",
          total: 115,
          tax: 15,
        },
      ],
      [
        {
          customer_id: "customer-1",
          customer: { name: "أحمد" },
          status: "posted",
          total: 23,
          tax: 3,
        },
      ],
      () => ({ cashCollected: 80, returnSettled: 10 }),
    );

    expect(rows).toEqual([
      {
        name: "أحمد",
        count: 1,
        total: 100,
        invoiceGrossTotal: 115,
        cashCollected: 80,
        returnSettled: 10,
        returns: 20,
        returnOnly: false,
      },
    ]);
  });

  it("keeps a standalone cash-customer return as a return-only row", () => {
    const rows = buildCustomerSalesGroups(
      [],
      [
        {
          customer_id: null,
          customer: null,
          status: "posted",
          total: 50,
          tax: 0,
        },
      ],
      () => ({ cashCollected: 0, returnSettled: 0 }),
    );

    expect(rows).toEqual([
      expect.objectContaining({
        name: "عميل نقدي",
        count: 0,
        returns: 50,
        returnOnly: true,
      }),
    ]);
  });
});

interface Group {
  name: string;
  sales: number;
  returns: number;
}

describe("groupSalesAndReturns", () => {
  it("ينشئ مجموعات من اتحاد مفاتيح المبيعات والمرتجعات", () => {
    const groups = groupSalesAndReturns(
      [
        { key: "shared", name: "مشترك", amount: 100 },
        { key: "sale-only", name: "مبيعات فقط", amount: 50 },
      ],
      [
        { key: "shared", name: "مشترك", amount: 20 },
        { key: "return-only", name: "مرتجع فقط", amount: 30 },
      ],
      {
        getSaleKey: (row) => row.key,
        getReturnKey: (row) => row.key,
        createFromSale: (_key, row): Group => ({
          name: row.name,
          sales: 0,
          returns: 0,
        }),
        createFromReturn: (_key, row): Group => ({
          name: row.name,
          sales: 0,
          returns: 0,
        }),
        addSale: (group, row) => {
          group.sales += row.amount;
        },
        addReturn: (group, row) => {
          group.returns += row.amount;
        },
      },
    );

    expect(Array.from(groups.keys())).toEqual([
      "shared",
      "sale-only",
      "return-only",
    ]);
    expect(groups.get("shared")).toEqual({
      name: "مشترك",
      sales: 100,
      returns: 20,
    });
    expect(groups.get("return-only")).toEqual({
      name: "مرتجع فقط",
      sales: 0,
      returns: 30,
    });
  });

  it("يجمع عدة مرتجعات مستقلة تحت المفتاح نفسه", () => {
    const groups = groupSalesAndReturns<never, { key: string; amount: number }, Group>(
      [],
      [
        { key: "product-1", amount: 15 },
        { key: "product-1", amount: 25 },
      ],
      {
        getSaleKey: () => "",
        getReturnKey: (row) => row.key,
        createFromSale: (): Group => ({ name: "", sales: 0, returns: 0 }),
        createFromReturn: (key): Group => ({
          name: key,
          sales: 0,
          returns: 0,
        }),
        addSale: () => undefined,
        addReturn: (group, row) => {
          group.returns += row.amount;
        },
      },
    );

    expect(groups.get("product-1")).toEqual({
      name: "product-1",
      sales: 0,
      returns: 40,
    });
  });
});
