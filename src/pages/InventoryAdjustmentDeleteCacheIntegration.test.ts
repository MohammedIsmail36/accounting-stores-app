import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const form = readFileSync(join(process.cwd(), "src/pages/InventoryAdjustmentForm.tsx"), "utf8");
const list = readFileSync(join(process.cwd(), "src/pages/InventoryAdjustments.tsx"), "utf8");
const deleteForm = form.split("  async function handleDeleteDraft() {")[1]
  ?.split("  async function handleApprove() {")[0];

describe("انتقال واجهة التسويات بعد الحذف", () => {
  it("يحدث الكاش بعد نجاح الحذف وقبل الانتقال من صفحة التفاصيل", () => {
    expect(deleteForm).toContain("await deleteInventoryAdjustmentDraft(id, loadedUpdatedAt);");
    expect(deleteForm).toContain("removeDeletedInventoryAdjustmentFromCache(queryClient, id);");
    expect(deleteForm?.indexOf("removeDeletedInventoryAdjustmentFromCache"))
      .toBeLessThan(deleteForm!.indexOf('navigate("/inventory-adjustments")'));
  });
  it("لا يعرض زر حذف داخل صف القائمة المتداخل مع فتح المسودة", () => {
    expect(list).toContain("queryKey: inventoryAdjustmentsQueryKey");
    expect(list).toContain("onRowClick={(row) => navigate(");
    expect(list).not.toContain('id: "actions"');
    expect(list).not.toContain("deleteMutation");
  });
});
