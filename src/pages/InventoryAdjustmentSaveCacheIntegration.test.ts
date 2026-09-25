import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/pages/InventoryAdjustmentForm.tsx"), "utf8");
const save = source.split("  async function handleSave() {")[1]
  ?.split("  async function handleDeleteDraft() {")[0];

describe("قائمة التسويات بعد حفظ المسودة", () => {
  it("يمحو القائمة القديمة فقط بعد نجاح الحفظ وقبل الانتقال إلى التفاصيل", () => {
    expect(save).toContain("const result = await saveInventoryAdjustmentDraft({");
    expect(save).toContain("clearInventoryAdjustmentsCacheAfterSave(queryClient);");
    expect(save!.indexOf("clearInventoryAdjustmentsCacheAfterSave"))
      .toBeGreaterThan(save!.indexOf("const result = await saveInventoryAdjustmentDraft"));
    expect(save!.indexOf("clearInventoryAdjustmentsCacheAfterSave"))
      .toBeLessThan(save!.indexOf("navigate(`/inventory-adjustments/${result.adjustment_id}`)"));
  });
});
