import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/pages/InventoryAdjustmentForm.tsx"), "utf8");
const save = source.split("  async function handleSave() {")[1]
  ?.split("  async function handleDeleteDraft() {")[0];

describe("سبب فرق التسوية في الواجهة", () => {
  it("يحفظ الرمز والمرجع داخل الطلب الذري نفسه ولا ينشئ طلب كتابة منفصلًا", () => {
    expect(save).toContain("reason_code: item.reason_code || null");
    expect(save).toContain("reason_reference: item.reason_reference.trim() || null");
    expect(save).toContain("saveInventoryAdjustmentDraft({");
    expect(save).not.toContain(".insert(");
    expect(save).not.toContain(".update(");
  });

  it("يفصل سبب الفرق عن ملاحظات البند ويستخدم اختيار النظام", () => {
    expect(source).toContain("INVENTORY_ADJUSTMENT_REASONS.map");
    expect(source).toContain("سبب قديم غير مصنف");
    expect(source).toContain("inventoryAdjustmentReasonLabel(it.reason_code)");
    expect(source).toContain("reason_reference: it.reason_reference ||");
    expect(source).toContain("سبب الفرق");
    expect(source).toContain("ملاحظات البند");
    expect(source).toContain('from "@/components/ui/select"');
    expect(source).toContain("<SelectTrigger");
    expect(source).toContain("<SelectItem");
    expect(source).not.toContain('<select\\n                            value={item.reason_code}');
  });
  it("لا يكرر وصف التسوية في بطاقة ملاحظات مرتبطة بالحقل نفسه", () => {
    expect(source).toContain('value={description}');
    expect(source).not.toContain("ملاحظات حول عملية الجرد");
    expect(source).not.toContain("<textarea");
  });
});
