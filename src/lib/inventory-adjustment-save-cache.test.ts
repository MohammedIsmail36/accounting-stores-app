import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  inventoryAdjustmentsQueryKey,
  upsertSavedInventoryAdjustmentInCache,
} from "./inventory-adjustment-cache";

describe("قائمة التسويات بعد حفظ أول مسودة", () => {
  it("يبقي القائمة المحملة فارغة سابقًا ظاهرة ويضيف المسودة دون تحميل كامل", () => {
    const client = new QueryClient();
    client.setQueryData(inventoryAdjustmentsQueryKey, []);

    upsertSavedInventoryAdjustmentInCache(client, {
      id: "new",
      adjustmentNumber: 25,
      adjustmentDate: "2026-09-25",
      description: "تسوية جديدة",
      updatedAt: "2026-09-25T00:00:00Z",
    });

    expect(client.getQueryData(inventoryAdjustmentsQueryKey)).toMatchObject([
      { id: "new", adjustment_number: 25, status: "draft" },
    ]);
    expect(client.getQueryState(inventoryAdjustmentsQueryKey)?.isInvalidated).toBe(true);
  });
});
