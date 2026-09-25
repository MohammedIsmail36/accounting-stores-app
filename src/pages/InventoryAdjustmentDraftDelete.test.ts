import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const form = readFileSync(join(process.cwd(), "src/pages/InventoryAdjustmentForm.tsx"), "utf8");
const list = readFileSync(join(process.cwd(), "src/pages/InventoryAdjustments.tsx"), "utf8");
const deleteForm = form.split("  async function handleDeleteDraft() {")[1]
  ?.split("  async function handleApprove() {")[0];

describe("حذف مسودة التسوية من صفحة التفاصيل", () => {
  it("يستعمل طلبًا واحدًا ونسخة المستند ولا يحذف الرأس والبنود بطلبات منفصلة", () => {
    expect(deleteForm).toContain("deleteInventoryAdjustmentDraft(id, loadedUpdatedAt)");
    expect(deleteForm).not.toContain(".delete(");
  });
  it("يعرض زر الحذف للمدير فقط في التفاصيل ولا يعرضه في القائمة", () => {
    expect(form).toContain('!isNew && isDraft && role === "admin" && (\n            <ConfirmDialog\n              trigger={');
    expect(list).not.toContain('aria-label="حذف التسوية"');
    expect(list).not.toContain("<ConfirmDialog");
  });
});
