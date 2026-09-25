import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const form = readFileSync(join(process.cwd(), "src/pages/InventoryAdjustmentForm.tsx"), "utf8");
const list = readFileSync(join(process.cwd(), "src/pages/InventoryAdjustments.tsx"), "utf8");
const deleteForm = form.split("  async function handleDeleteDraft() {")[1]
  ?.split("  async function handleApprove() {")[0];
const deleteList = list.split("  const deleteMutation = useMutation({")[1]
  ?.split("  const approvedCount =")[0];

describe("انتقال واجهة التسويات بعد الحذف", () => {
  it("يحدث الكاش بعد نجاح الحذف وقبل الانتقال من صفحة التفاصيل", () => {
    expect(deleteForm).toContain("await deleteInventoryAdjustmentDraft(id, loadedUpdatedAt);");
    expect(deleteForm).toContain("removeDeletedInventoryAdjustmentFromCache(queryClient, id);");
    expect(deleteForm?.indexOf("removeDeletedInventoryAdjustmentFromCache"))
      .toBeLessThan(deleteForm!.indexOf('navigate("/inventory-adjustments")'));
  });
  it("يحدث نفس الكاش عند الحذف من القائمة ويستخدم مفتاح الاستعلام نفسه", () => {
    expect(list).toContain("queryKey: inventoryAdjustmentsQueryKey");
    expect(deleteList).toContain("removeDeletedInventoryAdjustmentFromCache(queryClient, id)");
  });
});
