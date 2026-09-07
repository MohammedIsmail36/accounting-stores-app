import { describe, it, expect } from "vitest";
import {
  summarizeMovements,
  weightedAverageCost,
  inventoryValue,
  netSoldQuantity,
  turnoverRate,
  averageQuantity,
  daysOfCover,
  daysSinceLastSale,
  productAgeDays,
  stockStatus,
  suggestedPurchaseQuantity,
  computeInventoryTotals,
  signedQuantity,
  signedValue,
  type InventoryMovementRow,
} from "./inventory-metrics";

const mv = (
  type: string,
  quantity: number,
  total_cost: number,
  movement_date = "2026-01-01",
  product_id = "p1",
): InventoryMovementRow => ({
  product_id,
  movement_type: type,
  quantity,
  total_cost,
  movement_date,
});

describe("signedQuantity / signedValue", () => {
  it("يزيد بالمشتريات والرصيد الافتتاحي ومرتجع البيع", () => {
    expect(signedQuantity(mv("purchase", 10, 1000))).toBe(10);
    expect(signedQuantity(mv("opening_balance", 5, 500))).toBe(5);
    expect(signedQuantity(mv("sale_return", 2, 200))).toBe(2);
  });

  it("ينقص بالبيع ومرتجع الشراء", () => {
    expect(signedQuantity(mv("sale", 3, 300))).toBe(-3);
    expect(signedQuantity(mv("purchase_return", 4, 400))).toBe(-4);
  });

  it("يحترم إشارة التسوية الموقّعة", () => {
    expect(signedQuantity(mv("adjustment", -6, 600))).toBe(-6);
    expect(signedValue(mv("adjustment", -6, 600))).toBe(-600);
    expect(signedValue(mv("adjustment", 6, 600))).toBe(600);
  });

  it("يتجاهل إشارة الكمية المخزّنة خطأً في الحركات العادية", () => {
    expect(signedQuantity(mv("sale", -3, 300))).toBe(-3);
    expect(signedValue(mv("sale", -3, 300))).toBe(-300);
  });

  it("يحسب القيمة من unit_cost عند غياب total_cost", () => {
    expect(
      signedValue({
        product_id: "p1",
        movement_type: "purchase",
        quantity: 4,
        unit_cost: 25,
        total_cost: null,
      }),
    ).toBe(100);
  });
});

describe("summarizeMovements", () => {
  const moves: InventoryMovementRow[] = [
    mv("opening_balance", 10, 1000, "2026-01-01"),
    mv("purchase", 10, 1200, "2026-01-05"),
    mv("sale", 5, 600, "2026-01-10"),
    mv("sale_return", 1, 120, "2026-01-12"),
    mv("purchase_return", 2, 240, "2026-01-15"),
    mv("adjustment", -1, 110, "2026-01-20"),
    mv("purchase", 3, 400, "2026-02-01", "p2"),
  ];

  it("يجمّع كل منتج على حدة", () => {
    const s = summarizeMovements(moves);
    expect(s.size).toBe(2);
    expect(s.get("p2")!.quantity).toBe(3);
  });

  it("يحسب الكمية والقيمة الصافية بشكل صحيح", () => {
    const s = summarizeMovements(moves).get("p1")!;
    // 10 + 10 - 5 + 1 - 2 - 1 = 13
    expect(s.quantity).toBe(13);
    // 1000 + 1200 - 600 + 120 - 240 - 110 = 1370
    expect(s.value).toBe(1370);
  });

  it("يفصل الكميات حسب النوع", () => {
    const s = summarizeMovements(moves).get("p1")!;
    expect(s.purchasedQty).toBe(20);
    expect(s.purchasedCost).toBe(2200);
    expect(s.soldQty).toBe(5);
    expect(s.salesReturnQty).toBe(1);
    expect(s.purchaseReturnQty).toBe(2);
    expect(s.adjustmentQty).toBe(-1);
  });

  it("يرصد آخر تاريخ بيع وآخر حركة", () => {
    const s = summarizeMovements(moves).get("p1")!;
    expect(s.lastSaleDate).toBe("2026-01-10");
    expect(s.lastMovementDate).toBe("2026-01-20");
  });

  it("يتجاهل الحركات بدون منتج", () => {
    const s = summarizeMovements([
      { product_id: "", movement_type: "sale", quantity: 5, total_cost: 5 },
    ]);
    expect(s.size).toBe(0);
  });
});

describe("weightedAverageCost", () => {
  it("يحسب WAC من المشتريات والافتتاحي فقط", () => {
    const s = summarizeMovements([
      mv("opening_balance", 10, 1000),
      mv("purchase", 10, 1400),
      mv("sale", 5, 600),
    ]).get("p1")!;
    expect(weightedAverageCost(s)).toBe(120);
  });

  it("يرجع لسعر الشراء عند غياب المشتريات", () => {
    expect(weightedAverageCost(undefined, 75)).toBe(75);
    const s = summarizeMovements([mv("sale", 1, 10)]).get("p1")!;
    expect(weightedAverageCost(s, 42)).toBe(42);
  });
});

describe("قياسات القرار", () => {
  it("inventoryValue", () => {
    expect(inventoryValue(13, 110)).toBe(1430);
  });

  it("netSoldQuantity يخصم مرتجعات البيع", () => {
    const s = summarizeMovements([
      mv("sale", 10, 1000),
      mv("sale_return", 3, 300),
    ]).get("p1")!;
    expect(netSoldQuantity(s)).toBe(7);
  });

  it("turnoverRate يعيد null بدل صفر مضلّل", () => {
    expect(turnoverRate(50, 25)).toBe(2);
    expect(turnoverRate(50, 0)).toBeNull();
  });

  it("averageQuantity", () => {
    expect(averageQuantity(10, 30)).toBe(20);
  });

  it("daysOfCover", () => {
    expect(daysOfCover(30, 30, 30)).toBe(30);
    expect(daysOfCover(30, 0, 30)).toBeNull();
    expect(daysOfCover(30, 10, 0)).toBeNull();
  });

  it("daysSinceLastSale", () => {
    const today = new Date("2026-03-01T00:00:00Z");
    expect(daysSinceLastSale("2026-02-01", today)).toBe(28);
    expect(daysSinceLastSale(null, today)).toBeNull();
    expect(daysSinceLastSale("غير صالح", today)).toBeNull();
  });

  it("productAgeDays", () => {
    const today = new Date("2026-03-01T00:00:00Z");
    expect(productAgeDays("2026-01-01T00:00:00Z", today)).toBe(59);
    expect(productAgeDays(null, today)).toBeNull();
  });

  it("stockStatus", () => {
    expect(stockStatus(0, 5)).toBe("out");
    expect(stockStatus(-2, 5)).toBe("out");
    expect(stockStatus(5, 5)).toBe("low");
    expect(stockStatus(6, 5)).toBe("ok");
    expect(stockStatus(1, 0)).toBe("ok");
  });
});

describe("suggestedPurchaseQuantity", () => {
  it("يقترح تغطية 30 يومًا بمعدل البيع", () => {
    // 60 مبيع في 30 يوم = 2/يوم ⇒ هدف 60، متاح 10 ⇒ 50
    expect(
      suggestedPurchaseQuantity({
        quantityOnHand: 10,
        netSold: 60,
        periodDays: 30,
      }),
    ).toBe(50);
  });

  it("لا يقترح شيئًا عند كفاية المخزون", () => {
    expect(
      suggestedPurchaseQuantity({
        quantityOnHand: 100,
        netSold: 60,
        periodDays: 30,
      }),
    ).toBe(0);
  });

  it("يحترم الحد الأدنى عند غياب المبيعات", () => {
    expect(
      suggestedPurchaseQuantity({
        quantityOnHand: 2,
        netSold: 0,
        periodDays: 30,
        minStockLevel: 10,
      }),
    ).toBe(8);
  });
});

describe("computeInventoryTotals", () => {
  it("يجمع الكميات والقيم ويصنّف الحالات", () => {
    const t = computeInventoryTotals([
      { quantity: 10, wac: 100, minStockLevel: 5 },
      { quantity: 3, wac: 50, minStockLevel: 5 },
      { quantity: 0, wac: 20, minStockLevel: 5 },
    ]);
    expect(t.productCount).toBe(3);
    expect(t.totalQuantity).toBe(13);
    expect(t.totalValue).toBe(1150);
    expect(t.outOfStockCount).toBe(1);
    expect(t.lowStockCount).toBe(1);
  });

  it("لا يحسب المنتج غير المحدود بحد أدنى كمنخفض", () => {
    const t = computeInventoryTotals([{ quantity: 1, wac: 10 }]);
    expect(t.lowStockCount).toBe(0);
  });
});
