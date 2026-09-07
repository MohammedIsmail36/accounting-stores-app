import { describe, expect, it } from "vitest";
import {
  hydrateSalesDocumentItems,
  normalizeSalesProductCatalog,
} from "@/lib/sales-product-catalog";
describe("sales product catalog", () => {
  it("keeps only sale-safe product fields", () => {
    const [product] = normalizeSalesProductCatalog([
      {
        id: "product-1",
        code: "P-1",
        name: "منتج اختبار",
        barcode: "123",
        model_number: "M1",
        selling_price: 150,
        quantity_on_hand: 20,
        is_active: true,
        product_brands: { name: "ماركة" },
        purchase_price: 60,
        unit_cost: 60,
        total_cost: 1200,
      } as never,
    ]);

    expect(product).toEqual({
      id: "product-1",
      code: "P-1",
      name: "منتج اختبار",
      barcode: "123",
      model_number: "M1",
      selling_price: 150,
      quantity_on_hand: 20,
      is_active: true,
      product_brands: { name: "ماركة" },
    });
    expect(product).not.toHaveProperty("purchase_price");
    expect(product).not.toHaveProperty("unit_cost");
    expect(product).not.toHaveProperty("total_cost");
  });

  it("hydrates existing document lines from the safe catalog", () => {
    const catalog = normalizeSalesProductCatalog([
      {
        id: "product-1",
        code: "P-1",
        name: "منتج اختبار",
        barcode: null,
        model_number: "M1",
        selling_price: 150,
        quantity_on_hand: 20,
        is_active: false,
        product_brands: { name: "ماركة" },
      },
    ]);

    const [line] = hydrateSalesDocumentItems(
      [
        {
          id: "line-1",
          product_id: "product-1",
          description: null,
          quantity: 2,
          unit_price: 150,
          discount: 0,
          total: 300,
        },
      ],
      catalog,
    );

    expect(line.products).toEqual({
      name: "منتج اختبار",
      code: "P-1",
      model_number: "M1",
      product_brands: { name: "ماركة" },
    });
  });
});
