import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  inventoryAdjustmentsQueryKey,
  upsertSavedInventoryAdjustmentInCache,
  type InventoryAdjustmentListRow,
} from "./inventory-adjustment-cache";

const original: InventoryAdjustmentListRow = {
  id: "old",
  adjustment_number: 21,
  posted_number: null,
  adjustment_date: "2026-09-24",
  description: "قبل التعديل",
  status: "draft",
  created_at: "2026-09-24T00:00:00Z",
  updated_at: "2026-09-24T00:00:00Z",
};

describe("تحديث قائمة التسويات فور حفظ المسودة", () => {
  it("يضيف المسودة الجديدة للقائمة المحملة دون إفراغها", () => {
    const client = new QueryClient();
    client.setQueryData(inventoryAdjustmentsQueryKey, [original]);
    upsertSavedInventoryAdjustmentInCache(client, {
      id: "new",
      adjustmentNumber: 25,
      adjustmentDate: "2026-09-25",
      description: "جديدة",
      updatedAt: "2026-09-25T00:00:00Z",
    });
    const rows = client.getQueryData<InventoryAdjustmentListRow[]>(inventoryAdjustmentsQueryKey);
    expect(rows?.map((row) => row.id)).toEqual(["new", "old"]);
    expect(rows?.[0]).toMatchObject({ status: "draft", description: "جديدة" });
  });

  it("يحدث المسودة الموجودة دون تكرارها أو تغيير تاريخ إنشائها", () => {
    const client = new QueryClient();
    client.setQueryData(inventoryAdjustmentsQueryKey, [original]);
    upsertSavedInventoryAdjustmentInCache(client, {
      id: "old",
      adjustmentNumber: 21,
      adjustmentDate: "2026-09-25",
      description: "بعد التعديل",
      updatedAt: "2026-09-25T00:00:00Z",
    });
    const rows = client.getQueryData<InventoryAdjustmentListRow[]>(inventoryAdjustmentsQueryKey);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      description: "بعد التعديل",
      created_at: original.created_at,
    });
  });

  it("لا ينشئ قائمة وهمية إن لم تُحمّل من قبل", () => {
    const client = new QueryClient();
    upsertSavedInventoryAdjustmentInCache(client, {
      id: "new",
      adjustmentNumber: 25,
      adjustmentDate: "2026-09-25",
      description: "جديدة",
      updatedAt: "2026-09-25T00:00:00Z",
    });
    expect(client.getQueryData(inventoryAdjustmentsQueryKey)).toBeUndefined();
  });
});
