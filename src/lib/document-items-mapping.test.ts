import { describe, it, expect } from "vitest";
import { mapLoadedLineItems, type LoadedItemRow } from "./document-items-mapping";

const baseRow: LoadedItemRow = {
  id: "row-1",
  product_id: "prod-1",
  description: "وصف حر",
  quantity: 3,
  unit_price: 100,
  discount: 10,
  total: 290,
  products: {
    name: "قميص",
    code: "P-001",
    model_number: "M10",
    purchase_price: 60,
    product_brands: { name: "ماركة" },
  },
};

describe("mapLoadedLineItems", () => {
  it("يعيد مصفوفة فارغة عند null/undefined", () => {
    expect(mapLoadedLineItems(null)).toEqual([]);
    expect(mapLoadedLineItems(undefined)).toEqual([]);
    expect(mapLoadedLineItems([])).toEqual([]);
  });

  it("يبني اسم العرض الموحّد للمنتج", () => {
    const [item] = mapLoadedLineItems([baseRow]);
    expect(item.product_name).toContain("قميص");
    expect(item.product_name).toContain("ماركة");
    expect(item.product_name).toContain("M10");
  });

  it("يستخدم الوصف الحر عندما لا يوجد منتج مرتبط", () => {
    const [item] = mapLoadedLineItems([{ ...baseRow, products: null }]);
    expect(item.product_name).toBe("وصف حر");
    expect(item.product_id).toBe("prod-1");
  });

  it("يعيد نصًا فارغًا عند غياب المنتج والوصف", () => {
    const [item] = mapLoadedLineItems([
      { ...baseRow, products: null, description: null, product_id: null },
    ]);
    expect(item.product_name).toBe("");
    expect(item.product_id).toBe("");
  });

  it("لا يضيف cost_price افتراضيًا", () => {
    const [item] = mapLoadedLineItems([baseRow]);
    expect(item.cost_price).toBeUndefined();
  });

  it("يضيف cost_price من سعر الشراء عند الطلب", () => {
    const [item] = mapLoadedLineItems([baseRow], { withCostPrice: true });
    expect(item.cost_price).toBe(60);
  });

  it("يستخدم صفرًا عندما لا يوجد سعر شراء", () => {
    const [item] = mapLoadedLineItems(
      [{ ...baseRow, products: { ...baseRow.products, purchase_price: null } }],
      { withCostPrice: true },
    );
    expect(item.cost_price).toBe(0);
  });

  it("يحافظ على القيم الرقمية وترتيب الصفوف كما وردت", () => {
    const items = mapLoadedLineItems([
      { ...baseRow, id: "a" },
      { ...baseRow, id: "b", quantity: 1, unit_price: 5, discount: 0, total: 5 },
    ]);
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(items[0]).toMatchObject({ quantity: 3, unit_price: 100, discount: 10, total: 290 });
    expect(items[1]).toMatchObject({ quantity: 1, unit_price: 5, discount: 0, total: 5 });
  });
});
