import { describe, it, expect } from "vitest";
import { distributeNetTotals } from "./invoice-totals";
import {
  buildLineItemPayloads,
  buildLineItemRows,
  PersistableLineItem,
} from "./invoice-items";

const item = (over: Partial<PersistableLineItem> = {}): PersistableLineItem => ({
  product_id: "p1",
  product_name: "منتج",
  quantity: 1,
  unit_price: 100,
  discount: 0,
  total: 100,
  ...over,
});

describe("distributeNetTotals", () => {
  it("بدون خصم عام — net_total = الإجمالي", () => {
    const r = distributeNetTotals([{ total: 100 }, { total: 50 }], 0);
    expect(r.map((x) => x.net_total)).toEqual([100, 50]);
  });

  it("خصم عام يُوزّع تناسبيًا ومجموع الصافي = الأساس ناقص الخصم", () => {
    const r = distributeNetTotals([{ total: 300 }, { total: 100 }], 40);
    expect(r.map((x) => x.net_total)).toEqual([270, 90]);
    expect(r.reduce((s, x) => s + x.net_total, 0)).toBe(360);
  });

  it("يستخدم الأساس الصريح (subtotal المقرّب) عند تمريره", () => {
    const r = distributeNetTotals([{ total: 100 }], 10, 200);
    expect(r[0].net_total).toBe(95);
  });

  it("أساس صفري لا يسبب قسمة على صفر", () => {
    const r = distributeNetTotals([{ total: 0 }], 50);
    expect(r[0].net_total).toBe(0);
  });

  it("خصم سالب أو صفر يُتجاهل", () => {
    expect(distributeNetTotals([{ total: 100 }], -20)[0].net_total).toBe(100);
  });

  it("يقرّب لخانتين عشريتين", () => {
    const r = distributeNetTotals([{ total: 33.33 }, { total: 66.67 }], 10);
    expect(r[0].net_total).toBe(30);
    expect(r[1].net_total).toBe(60);
  });

  it("خصم مساوٍ للأساس يُصفّر الصافي", () => {
    const r = distributeNetTotals([{ total: 100 }, { total: 100 }], 200);
    expect(r.map((x) => x.net_total)).toEqual([0, 0]);
  });

  it("يحافظ على بقية حقول السطر", () => {
    const r = distributeNetTotals([item({ total: 100 })], 0);
    expect(r[0].product_id).toBe("p1");
    expect(r[0].quantity).toBe(1);
  });

  it("مطابق للمعادلة القديمة: total − (total/sum)×discount", () => {
    const items = [{ total: 123.45 }, { total: 76.55 }];
    const sum = 200;
    const d = 37.5;
    const legacy = items.map((i) =>
      Math.round((i.total - (i.total / sum) * d) * 100) / 100,
    );
    expect(distributeNetTotals(items, d).map((x) => x.net_total)).toEqual(legacy);
  });
});

describe("buildLineItemRows", () => {
  it("يبني صفوف الفواتير بمفتاح invoice_id وترتيب متسلسل", () => {
    const rows = buildLineItemRows(
      [item({ product_id: "a" }), item({ product_id: "b", total: 50 })],
      { parentKey: "invoice_id", parentId: "inv-1" },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      invoice_id: "inv-1",
      product_id: "a",
      description: "منتج",
      total: 100,
      net_total: 100,
      sort_order: 0,
    });
    expect(rows[1]).toMatchObject({ product_id: "b", net_total: 50, sort_order: 1 });
  });

  it("يبني صفوف المرتجعات بمفتاح return_id", () => {
    const rows = buildLineItemRows([item()], { parentKey: "return_id", parentId: "ret-9" });
    expect(rows[0]).toMatchObject({ return_id: "ret-9" });
    expect(rows[0]).not.toHaveProperty("invoice_id");
  });

  it("يوزّع الخصم العام على صفوف البنود", () => {
    const rows = buildLineItemRows(
      [item({ total: 300 }), item({ total: 100 })],
      { parentKey: "invoice_id", parentId: "i", reduction: 40 },
    );
    expect(rows.map((r) => r.net_total)).toEqual([270, 90]);
  });

  it("يحافظ على خصم السطر كما هو دون إعادة حسابه", () => {
    const rows = buildLineItemRows([item({ discount: 25, total: 75 })], {
      parentKey: "invoice_id",
      parentId: "i",
    });
    expect(rows[0]).toMatchObject({ discount: 25, total: 75, net_total: 75 });
  });

  it("قائمة فارغة تُنتج صفوفًا فارغة", () => {
    expect(buildLineItemRows([], { parentKey: "invoice_id", parentId: "i" })).toEqual([]);
  });

  it("يحفظ الترتيب الأصلي للسطور", () => {
    const rows = buildLineItemRows(
      ["a", "b", "c", "d"].map((p) => item({ product_id: p })),
      { parentKey: "invoice_id", parentId: "i" },
    );
    expect(rows.map((r) => r.product_id)).toEqual(["a", "b", "c", "d"]);
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2, 3]);
  });
});

describe("buildLineItemPayloads", () => {
  it("يبني بنود الحفظ الذرّي دون معرّف أب", () => {
    const rows = buildLineItemPayloads(
      [item({ product_id: "a", total: 300 }), item({ product_id: "b", total: 100 })],
      { reduction: 40, base: 400 },
    );

    expect(rows).toEqual([
      expect.objectContaining({ product_id: "a", net_total: 270, sort_order: 0 }),
      expect.objectContaining({ product_id: "b", net_total: 90, sort_order: 1 }),
    ]);
    expect(rows[0]).not.toHaveProperty("invoice_id");
    expect(rows[0]).not.toHaveProperty("return_id");
  });
});
