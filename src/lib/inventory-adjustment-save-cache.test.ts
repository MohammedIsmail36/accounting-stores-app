import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  clearInventoryAdjustmentsCacheAfterSave,
  inventoryAdjustmentsQueryKey,
} from "./inventory-adjustment-cache";

describe("تحديث قائمة التسويات بعد حفظ المسودة", () => {
  it("يزيل القائمة القديمة كي تجلب الصفحة نتيجة جديدة عند الرجوع إليها", () => {
    const client = new QueryClient();
    client.setQueryData(inventoryAdjustmentsQueryKey, [
      { id: "old", adjustment_number: 21 },
    ]);

    clearInventoryAdjustmentsCacheAfterSave(client);

    expect(client.getQueryData(inventoryAdjustmentsQueryKey)).toBeUndefined();
  });
});
