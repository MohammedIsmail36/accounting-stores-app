import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { DOCUMENT_STATUS_LABELS } from "./constants";
import {
  inventoryAdjustmentsQueryKey,
  updatePostedInventoryAdjustmentInCache,
  type InventoryAdjustmentListRow,
} from "./inventory-adjustment-cache";
import { formatInventoryAdjustmentNumber } from "./inventory-adjustment-number";

const draft: InventoryAdjustmentListRow = {
  id: "adjustment-35",
  adjustment_number: 35,
  posted_number: null,
  adjustment_date: "2026-09-27",
  description: "تسوية اختبار بصنفين",
  status: "draft",
  created_at: "2026-09-27T09:00:00Z",
  updated_at: "2026-09-27T09:00:00Z",
};

describe("تزامن قائمة وتصدير التسويات بعد الترحيل والعكس", () => {
  it("يعرض الرقم الرسمي والحالة المرحّلة فورًا دون تغيير رقم المسودة الداخلي", () => {
    const client = new QueryClient();
    client.setQueryData(inventoryAdjustmentsQueryKey, [draft]);
    updatePostedInventoryAdjustmentInCache(client, {
      id: draft.id,
      status: "posted",
      postedNumber: 3,
      updatedAt: "2026-09-27T09:10:00Z",
    });
    const rows = client.getQueryData<InventoryAdjustmentListRow[]>(inventoryAdjustmentsQueryKey);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      adjustment_number: 35,
      posted_number: 3,
      status: "posted",
      created_at: draft.created_at,
    });
    expect(formatInventoryAdjustmentNumber(
      rows![0].status, rows![0].adjustment_number, rows![0].posted_number,
    )).toBe("ADJ-0003");
    expect(DOCUMENT_STATUS_LABELS.adjustment[rows![0].status]).toBe("مُرحّل");
  });

  it("يحدّث الحالة إلى ملغي مع الاحتفاظ برقم الترحيل", () => {
    const client = new QueryClient();
    client.setQueryData(inventoryAdjustmentsQueryKey, [{
      ...draft, status: "posted", posted_number: 3,
    }]);
    updatePostedInventoryAdjustmentInCache(client, {
      id: draft.id,
      status: "cancelled",
      postedNumber: 3,
      updatedAt: "2026-09-27T09:20:00Z",
    });
    const row = client.getQueryData<InventoryAdjustmentListRow[]>(inventoryAdjustmentsQueryKey)?.[0];
    expect(row?.status).toBe("cancelled");
    expect(formatInventoryAdjustmentNumber(
      row!.status, row!.adjustment_number, row!.posted_number,
    )).toBe("ADJ-0003");
  });

  it("لا ينشئ قائمة وهمية إذا لم تكن قد حُمّلت", () => {
    const client = new QueryClient();
    updatePostedInventoryAdjustmentInCache(client, {
      id: draft.id,
      status: "posted",
      postedNumber: 3,
      updatedAt: "2026-09-27T09:10:00Z",
    });
    expect(client.getQueryData(inventoryAdjustmentsQueryKey)).toBeUndefined();
  });
});
