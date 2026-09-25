import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  inventoryAdjustmentsQueryKey,
  removeDeletedInventoryAdjustmentFromCache,
} from "./inventory-adjustment-cache";

describe("تحديث قائمة التسويات بعد الحذف", () => {
  it("يخفي السجل المحذوف فورًا من الكاش ويطلب تحديث القائمة", () => {
    const client = new QueryClient();
    client.setQueryData(inventoryAdjustmentsQueryKey, [
      { id: "deleted", adjustment_number: 23 },
      { id: "remaining", adjustment_number: 21 },
    ]);
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();

    removeDeletedInventoryAdjustmentFromCache(client, "deleted");

    expect(client.getQueryData(inventoryAdjustmentsQueryKey)).toEqual([
      { id: "remaining", adjustment_number: 21 },
    ]);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: inventoryAdjustmentsQueryKey,
      refetchType: "all",
    });
  });

  it("لا ينشئ قائمة وهمية إذا لم تكن القائمة محمّلة", () => {
    const client = new QueryClient();
    vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    removeDeletedInventoryAdjustmentFromCache(client, "deleted");
    expect(client.getQueryData(inventoryAdjustmentsQueryKey)).toBeUndefined();
  });
});
