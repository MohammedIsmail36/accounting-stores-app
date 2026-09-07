import { describe, it, expect } from "vitest";
import {
  formatProductName,
  productsToLookupItems,
  ProductWithBrand,
  SALES_PRODUCT_SELECT_FIELDS,
} from "./product-utils";

describe("SALES_PRODUCT_SELECT_FIELDS", () => {
  it("keeps cost columns out of sales-document product queries", () => {
    expect(SALES_PRODUCT_SELECT_FIELDS).toContain("selling_price");
    expect(SALES_PRODUCT_SELECT_FIELDS).toContain("quantity_on_hand");
    expect(SALES_PRODUCT_SELECT_FIELDS).not.toContain("purchase_price");
  });
});

describe("formatProductName", () => {
  it("should return only product name when no brand or model", () => {
    const product: ProductWithBrand = { id: "1", code: "P001", name: "قميص" };
    expect(formatProductName(product)).toBe("قميص");
  });

  it("should include brand when available", () => {
    const product: ProductWithBrand = {
      id: "1", code: "P001", name: "قميص",
      product_brands: { name: "زارا" },
    };
    expect(formatProductName(product)).toBe("قميص - زارا");
  });

  it("should include model number when available", () => {
    const product: ProductWithBrand = {
      id: "1", code: "P001", name: "قميص", model_number: "327",
    };
    expect(formatProductName(product)).toBe("قميص - 327");
  });

  it("should format correctly with brand and model", () => {
    const product: ProductWithBrand = {
      id: "1", code: "P001", name: "قميص قصير شيفون",
      product_brands: { name: "زارا" }, model_number: "327",
    };
    expect(formatProductName(product)).toBe("قميص قصير شيفون - زارا - 327");
  });

  it("should handle null brand and model", () => {
    const product: ProductWithBrand = {
      id: "1", code: "P001", name: "منتج",
      product_brands: null, model_number: null,
    };
    expect(formatProductName(product)).toBe("منتج");
  });

  it("should prefix code when withCode is true", () => {
    const product: ProductWithBrand = {
      id: "1", code: "P001", name: "قميص",
      product_brands: { name: "زارا" }, model_number: "327",
    };
    expect(formatProductName(product, { withCode: true })).toBe("[P001] قميص - زارا - 327");
  });

  it("should prefix code with name only", () => {
    const product: ProductWithBrand = { id: "1", code: "P002", name: "بنطلون" };
    expect(formatProductName(product, { withCode: true })).toBe("[P002] بنطلون");
  });
});


describe("productsToLookupItems", () => {
  const products: ProductWithBrand[] = [
    {
      id: "1", code: "P001", name: "قميص",
      product_brands: { name: "زارا" }, model_number: "327",
      quantity_on_hand: 50, selling_price: 150, barcode: "123456",
    },
    {
      id: "2", code: "P002", name: "بنطلون",
      product_brands: null, model_number: null,
      quantity_on_hand: 10,
    },
  ];

  it("should create lookup items with correct names", () => {
    const items = productsToLookupItems(products);
    expect(items[0].name).toBe("قميص - زارا - 327");
    expect(items[1].name).toBe("بنطلون");
  });

  it("should include quantity when showQty is true", () => {
    const items = productsToLookupItems(products, true);
    expect(items[0].name).toBe("قميص - زارا - 327 (50)");
    expect(items[1].name).toBe("بنطلون (10)");
  });

  it("should prefix code when showCode is true", () => {
    const items = productsToLookupItems(products, true, true);
    expect(items[0].name).toBe("[P001] قميص - زارا - 327 (50)");
    expect(items[1].name).toBe("[P002] بنطلون (10)");
  });


  it("should build search keywords from all fields", () => {
    const items = productsToLookupItems(products);
    expect(items[0].searchKeywords).toContain("P001");
    expect(items[0].searchKeywords).toContain("327");
    expect(items[0].searchKeywords).toContain("زارا");
    expect(items[0].searchKeywords).toContain("قميص");
    expect(items[0].searchKeywords).toContain("123456");
  });

  it("should have structured searchFields", () => {
    const items = productsToLookupItems(products);
    expect(items[0].searchFields).toEqual({
      code: "P001",
      name: "قميص",
      model: "327",
      brand: "زارا",
      barcode: "123456",
    });
    expect(items[1].searchFields).toEqual({
      code: "P002",
      name: "بنطلون",
    });
  });

  it("should return correct IDs", () => {
    const items = productsToLookupItems(products);
    expect(items[0].id).toBe("1");
    expect(items[1].id).toBe("2");
  });
});
