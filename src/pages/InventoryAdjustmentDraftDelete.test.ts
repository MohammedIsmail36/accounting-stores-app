import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const form = readFileSync(join(process.cwd(), "src/pages/InventoryAdjustmentForm.tsx"), "utf8");
const list = readFileSync(join(process.cwd(), "src/pages/InventoryAdjustments.tsx"), "utf8");
const deleteForm = form.split("  async function handleDeleteDraft() {")[1]
  ?.split("  async function handleApprove() {")[0];
const deleteList = list.split("  const deleteMutation = useMutation({")[1]
  ?.split("  const approvedCount =")[0];

describe("حذف مسودة التسوية من الواجهتين", () => {
  it("يستعمل طلبًا واحدًا ونسخة المستند ولا يحذف الرأس والبنود بطلبات منفصلة", () => {
    expect(deleteForm).toContain("deleteInventoryAdjustmentDraft(id, loadedUpdatedAt)");
    expect(deleteList).toContain("deleteInventoryAdjustmentDraft(id, updatedAt)");
    expect(deleteList).toContain("updatedAt: string");
    expect(deleteForm).not.toContain(".delete(");
    expect(deleteList).not.toContain(".delete(");
  });
  it("يعرض زر الحذف للمدير وحده في النموذج والقائمة", () => {
    expect(form).toContain('!isNew && isDraft && role === "admin" && (\n            <ConfirmDialog\n              trigger={');
    expect(list).toContain('row.original.status === "draft" && role === "admin"');
  });
});
